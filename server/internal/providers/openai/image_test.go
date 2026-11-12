package openai

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"image"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	imageinput "nori/studio/server/internal/domain/image"
	"nori/studio/server/internal/engine"
	imageop "nori/studio/server/internal/engine/ops/image"
	"nori/studio/server/internal/platform/blob"
	"nori/studio/server/internal/providers"
)

type memoryCalls struct {
	mu          sync.Mutex
	status      string
	submissions int
	metadata    json.RawMessage
}

func (s *memoryCalls) Claim(_ context.Context, _, _, _ string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.status != "" && s.status != "retryable" {
		return false, providers.ErrUncertain
	}
	if s.submissions >= 3 {
		return false, providers.ErrQuota
	}
	s.submissions++
	s.status = "pending"
	return true, nil
}
func (s *memoryCalls) Record(_ context.Context, _, status, _ string, metadata json.RawMessage) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.status = status
	s.metadata = metadata
	return nil
}

func testImage(t *testing.T, handler http.HandlerFunc) (*Image, *memoryCalls) {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	files, err := blob.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	calls := &memoryCalls{}
	return &Image{key: "test-key", model: DefaultImageModel, baseURL: server.URL, client: server.Client(), files: files, calls: calls}, calls
}
func input() providers.ImageRequest {
	return providers.ImageRequest{IdempotencyKey: uuid.NewString(), Input: imageinput.Input{Prompt: "A small cafe", Model: DefaultImageModel, Settings: imageinput.Settings{AspectRatio: "16:9"}}}
}
func pngBytes(t *testing.T) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := png.Encode(&b, image.NewRGBA(image.Rect(0, 0, 16, 9))); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}
func reply(w http.ResponseWriter, data []byte) {
	w.Header().Set("X-Request-Id", "req-test")
	_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{map[string]any{"b64_json": base64.StdEncoding.EncodeToString(data)}}, "usage": map[string]int{"input_tokens": 20, "output_tokens": 40}})
}
func TestGenerationRecoveryAndPublication(t *testing.T) {
	data := pngBytes(t)
	var count atomic.Int32
	model, calls := testImage(t, func(w http.ResponseWriter, r *http.Request) {
		count.Add(1)
		if r.URL.Path != "/images/generations" || r.Header.Get("Authorization") != "Bearer test-key" {
			t.Error("bad request")
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if body["model"] != DefaultImageModel || body["size"] != "1536x864" || body["quality"] != "medium" || body["output_format"] != "png" || body["n"] != float64(1) {
			t.Errorf("unexpected parameters: %v", body)
		}
		reply(w, data)
	})
	req := input()
	first, err := model.Generate(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	// A new adapter instance recovers the durable receipt, with no second HTTP call.
	restarted := *model
	second, err := restarted.Generate(context.Background(), req)
	if err != nil || first != second || count.Load() != 1 || calls.status != "completed" || !bytes.Contains(calls.metadata, []byte(`"input_tokens":20`)) {
		t.Fatalf("%+v calls=%d metadata=%s error=%v", second, count.Load(), calls.metadata, err)
	}
	file, err := restarted.Download(context.Background(), second.File)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	got, _ := io.ReadAll(file)
	if !bytes.Equal(got, data) {
		t.Fatal("image changed")
	}
	op := imageop.NewGenerate(&restarted, model.files, nil)
	raw, _ := json.Marshal(req.Input)
	out, err := op.Step(context.Background(), engine.Run{JobID: req.IdempotencyKey, Input: raw})
	if err != nil {
		t.Fatal(err)
	}
	next := out.(engine.Next)
	out, err = op.Step(context.Background(), engine.Run{JobID: req.IdempotencyKey, Input: raw, Step: next.Step, State: next.State})
	if err != nil || out.(engine.Done).Artifacts[0].Media == nil || count.Load() != 1 {
		t.Fatalf("publication: %v", err)
	}
	req.Input.Prompt = "a different prompt"
	if _, err := restarted.Generate(context.Background(), req); !errors.Is(err, providers.ErrUncertain) {
		t.Fatalf("reused receipt for changed input: %v", err)
	}
}
func TestReferenceGenerationAndEdit(t *testing.T) {
	for _, edit := range []bool{false, true} {
		t.Run(map[bool]string{false: "reference generation", true: "edit"}[edit], func(t *testing.T) {
			data := pngBytes(t)
			model, _ := testImage(t, func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/images/edits" {
					t.Errorf("path=%s", r.URL.Path)
				}
				if err := r.ParseMultipartForm(1 << 20); err != nil {
					t.Fatal(err)
				}
				defer r.MultipartForm.RemoveAll()
				want := 1
				if edit {
					want = 2
				}
				parts := r.MultipartForm.File["image[]"]
				if len(parts) != want {
					t.Fatalf("got %d files", len(parts))
				}
				for _, part := range parts {
					file, err := part.Open()
					if err != nil {
						t.Fatal(err)
					}
					got, _ := io.ReadAll(file)
					file.Close()
					if !bytes.Equal(data, got) || part.Header.Get("Content-Type") != "image/png" {
						t.Error("reference corrupted")
					}
				}
				prompt := r.FormValue("prompt")
				if !strings.Contains(prompt, "role identity") || (edit && !strings.Contains(prompt, "Input image 1 has role source")) {
					t.Errorf("roles missing: %s", prompt)
				}
				reply(w, data)
			})
			req := input()
			ref := providers.ImageReference{Role: "identity", ContentType: "image/png", Reader: bytes.NewReader(data)}
			req.References = []providers.ImageReference{ref}
			if edit {
				source := ref
				source.Role = "source"
				source.Reader = bytes.NewReader(data)
				req.Source = &source
			}
			var err error
			if edit {
				_, err = model.Edit(context.Background(), req)
			} else {
				_, err = model.Generate(context.Background(), req)
			}
			if err != nil {
				t.Fatal(err)
			}
		})
	}
}
func TestProviderFailures(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status int
		body   string
		want   error
	}{
		{"credentials", 401, `{}`, providers.ErrUnauthorized},
		{"quota", 429, `{"error":{"code":"insufficient_quota"}}`, providers.ErrQuota},
		{"moderation", 400, `{"error":{"code":"moderation_blocked"}}`, providers.ErrRejected},
		{"server uncertainty", 500, `{}`, providers.ErrUncertain},
		{"bad image", 200, `{"data":[{"b64_json":"bad"}]}`, providers.ErrRejected},
		{"malformed", 200, `broken`, providers.ErrRejected},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var count atomic.Int32
			model, _ := testImage(t, func(w http.ResponseWriter, r *http.Request) {
				count.Add(1)
				w.WriteHeader(tc.status)
				_, _ = io.WriteString(w, tc.body)
			})
			req := input()
			if _, err := model.Generate(context.Background(), req); !errors.Is(err, tc.want) {
				t.Fatalf("error=%v", err)
			}
			_, _ = model.Generate(context.Background(), req)
			if count.Load() != 1 {
				t.Fatal("failure resubmitted paid work")
			}
		})
	}
}
func TestRateLimitsAreBounded(t *testing.T) {
	var count atomic.Int32
	model, _ := testImage(t, func(w http.ResponseWriter, r *http.Request) {
		count.Add(1)
		w.Header().Set("Retry-After", "5")
		w.WriteHeader(429)
		_, _ = io.WriteString(w, `{"error":{"code":"rate_limit_exceeded"}}`)
	})
	req := input()
	for range 3 {
		_, err := model.Generate(context.Background(), req)
		var limited *providers.RateLimitedError
		if !errors.As(err, &limited) || limited.RetryAfter != 5*time.Second {
			t.Fatalf("%v", err)
		}
	}
	if _, err := model.Generate(context.Background(), req); !errors.Is(err, providers.ErrQuota) || count.Load() != 3 {
		t.Fatalf("calls=%d error=%v", count.Load(), err)
	}
}
func TestLostResponseDoesNotResubmit(t *testing.T) {
	var count atomic.Int32
	model, _ := testImage(t, func(w http.ResponseWriter, r *http.Request) {
		count.Add(1)
		h := w.(http.Hijacker)
		conn, _, err := h.Hijack()
		if err != nil {
			t.Error(err)
			return
		}
		conn.Close()
	})
	req := input()
	for range 2 {
		if _, err := model.Generate(context.Background(), req); !errors.Is(err, providers.ErrUncertain) {
			t.Fatalf("%v", err)
		}
	}
	if count.Load() != 1 {
		t.Fatal("resubmitted after connection loss")
	}
}

type failingStore struct {
	blob.Store
	suffix string
	fail   bool
}

func (s *failingStore) Put(ctx context.Context, key string, r io.Reader) (blob.Info, error) {
	if s.fail && strings.HasSuffix(key, s.suffix) {
		s.fail = false
		return blob.Info{}, errors.New("disk failed")
	}
	return s.Store.Put(ctx, key, r)
}
func TestStorageFailureRecovery(t *testing.T) {
	for _, suffix := range []string{"/image.png", "/response.json"} {
		t.Run(suffix, func(t *testing.T) {
			data := pngBytes(t)
			var count atomic.Int32
			model, _ := testImage(t, func(w http.ResponseWriter, r *http.Request) { count.Add(1); reply(w, data) })
			model.files = &failingStore{Store: model.files, suffix: suffix, fail: true}
			req := input()
			if _, err := model.Generate(context.Background(), req); err == nil {
				t.Fatal("ignored storage failure")
			}
			_, err := model.Generate(context.Background(), req)
			if suffix == "/image.png" && err != nil {
				t.Fatal(err)
			}
			if suffix == "/response.json" && !errors.Is(err, providers.ErrUncertain) {
				t.Fatalf("lost receipt: %v", err)
			}
			if count.Load() != 1 {
				t.Fatal("storage failure regenerated image")
			}
		})
	}
}
