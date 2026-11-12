package image

import (
	"context"
	"encoding/json"
	"errors"
	"image/png"
	"io"
	"testing"
	"time"

	"github.com/google/uuid"
	"nori/studio/server/internal/assets"
	"nori/studio/server/internal/engine"
	"nori/studio/server/internal/platform/apperr"
	"nori/studio/server/internal/platform/blob"
	"nori/studio/server/internal/providers"
	"nori/studio/server/internal/providers/fake"
)

type assetReaderFunc func(context.Context, string, string) (assets.Detail, error)

func (f assetReaderFunc) Get(ctx context.Context, owner, id string) (assets.Detail, error) {
	return f(ctx, owner, id)
}

type observedModel struct {
	fake.Image
	calls   int
	request providers.ImageRequest
	err     error
}

func (m *observedModel) Generate(ctx context.Context, req providers.ImageRequest) (providers.ImageOutput, error) {
	m.calls++
	m.request = req
	if m.err != nil {
		return providers.ImageOutput{}, m.err
	}
	return m.Image.Generate(ctx, req)
}
func (m *observedModel) Edit(ctx context.Context, req providers.ImageRequest) (providers.ImageOutput, error) {
	m.calls++
	m.request = req
	if m.err != nil {
		return providers.ImageOutput{}, m.err
	}
	return m.Image.Edit(ctx, req)
}

type unreliableStore struct {
	blob.Store
	fail bool
}

func (s *unreliableStore) Put(ctx context.Context, key string, r io.Reader) (blob.Info, error) {
	if s.fail {
		s.fail = false
		return blob.Info{}, errors.New("temporary disk failure")
	}
	return s.Store.Put(ctx, key, r)
}

func TestCanonicalize(t *testing.T) {
	op := NewGenerate(fake.Image{}, nil, nil)
	got, err := op.Canonicalize(json.RawMessage(`{"prompt":"  a cafe  "}`))
	if err != nil || string(got) != `{"prompt":"a cafe","model":"fake-image-v1","settings":{"aspectRatio":"1:1"},"references":[]}` {
		t.Fatalf("%s %v", got, err)
	}
	for _, input := range []string{
		`null`, `{"prompt":" "}`, `{"prompt":"cafe","model":"sunburst"}`,
		`{"prompt":"cafe","settings":{"aspectRatio":"4:3"}}`,
		`{"prompt":"cafe","settings":{"seed":2}}`,
		`{"prompt":"cafe","sourceAssetId":"` + uuid.NewString() + `"}`,
		`{"prompt":"cafe","references":[{"assetId":"bad","role":"identity"}]}`,
		`{"prompt":"cafe","references":[{"assetId":"` + uuid.NewString() + `","role":"audio"}]}`,
	} {
		if _, err := op.Canonicalize(json.RawMessage(input)); err == nil {
			t.Errorf("accepted %s", input)
		}
	}
	edit := NewEdit(fake.Image{}, nil, nil)
	if _, err := edit.Canonicalize(json.RawMessage(`{"prompt":"make it warmer"}`)); err == nil {
		t.Fatal("edit accepted without source")
	}
}

func TestStorageRetryDoesNotRegenerate(t *testing.T) {
	ctx := context.Background()
	disk, err := blob.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	store := &unreliableStore{Store: disk, fail: true}
	model := &observedModel{}
	op := NewGenerate(model, store, nil)
	run := engine.Run{JobID: uuid.NewString(), OwnerID: uuid.NewString(), Input: json.RawMessage(`{"prompt":"a cafe","settings":{"aspectRatio":"16:9"}}`)}
	out, err := op.Step(ctx, run)
	if err != nil {
		t.Fatal(err)
	}
	next, ok := out.(engine.Next)
	if !ok || next.Step != "store" {
		t.Fatalf("%+v", out)
	}
	run.Step, run.State = next.Step, next.State
	_, err = op.Step(ctx, run)
	var failure *engine.RunError
	if !errors.As(err, &failure) || failure.Code != "storage_error" || !failure.Retryable {
		t.Fatalf("%v", err)
	}
	for range 2 {
		out, err = op.Step(ctx, run)
		if err != nil {
			t.Fatal(err)
		}
		done := out.(engine.Done)
		if len(done.Artifacts) != 1 || done.Artifacts[0].Media.FileKey != "jobs/"+run.JobID+"/image.png" {
			t.Fatalf("%+v", done)
		}
	}
	if model.calls != 1 || model.request.IdempotencyKey != run.JobID {
		t.Fatalf("provider calls=%d", model.calls)
	}
	object, err := disk.Open(ctx, "jobs/"+run.JobID+"/image.png")
	if err != nil {
		t.Fatal(err)
	}
	defer object.Close()
	config, err := png.DecodeConfig(object)
	if err != nil || config.Width*9 != config.Height*16 {
		t.Fatalf("%+v %v", config, err)
	}
}

func TestEditResolvesPersistedOwner(t *testing.T) {
	ctx := context.Background()
	disk, err := blob.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	sample, err := (fake.Image{}).Download(ctx, "image-1-1.png")
	if err != nil {
		t.Fatal(err)
	}
	defer sample.Close()
	info, err := disk.Put(ctx, "inputs/source.png", sample)
	if err != nil {
		t.Fatal(err)
	}
	owner, sourceID := uuid.NewString(), uuid.NewString()
	reader := assetReaderFunc(func(_ context.Context, user, id string) (assets.Detail, error) {
		if user != owner || id != sourceID {
			return assets.Detail{}, apperr.ErrNotFound
		}
		return assets.Detail{Asset: assets.Asset{ID: id, Kind: "image"}, Files: []assets.File{{Role: "original", StorageKey: info.Key, ContentType: info.ContentType, SizeBytes: info.Size}}}, nil
	})
	model := &observedModel{}
	op := NewEdit(model, disk, reader)
	input := json.RawMessage(`{"prompt":"warmer lighting","sourceAssetId":"` + sourceID + `","references":[{"assetId":"` + sourceID + `","role":"identity"}]}`)
	run := engine.Run{JobID: uuid.NewString(), OwnerID: uuid.NewString(), Input: input}
	if _, err := op.Step(ctx, run); err == nil || model.calls != 0 {
		t.Fatalf("foreign input reached provider: %v", err)
	}
	run.OwnerID = owner
	out, err := op.Step(ctx, run)
	if err != nil {
		t.Fatal(err)
	}
	if model.calls != 1 || model.request.Source.AssetID != sourceID || len(model.request.References) != 1 {
		t.Fatalf("%+v", model.request)
	}
	next := out.(engine.Next)
	run.Step, run.State = next.Step, next.State
	out, err = op.Step(ctx, run)
	if err != nil {
		t.Fatal(err)
	}
	if out.(engine.Done).Artifacts[0].Media.SourceAssetID != sourceID {
		t.Fatal("lost edit provenance")
	}
}

func TestProviderErrors(t *testing.T) {
	for _, tc := range []struct {
		err   error
		code  string
		retry bool
	}{
		{providers.ErrUncertain, "provider_outcome_unknown", false}, {providers.ErrQuota, "provider_quota", false}, {providers.ErrRejected, "rejected", false}, {providers.ErrUnauthorized, "provider_unauthorized", false}, {errors.New("offline"), "provider_error", true},
	} {
		op := NewGenerate(&observedModel{err: tc.err}, nil, nil)
		_, err := op.Step(context.Background(), engine.Run{JobID: uuid.NewString(), Input: json.RawMessage(`{"prompt":"cafe"}`)})
		var failure *engine.RunError
		if !errors.As(err, &failure) || failure.Code != tc.code || failure.Retryable != tc.retry {
			t.Fatalf("%v", err)
		}
	}
	out, err := NewGenerate(&observedModel{err: &providers.RateLimitedError{RetryAfter: time.Second}}, nil, nil).Step(context.Background(), engine.Run{Input: json.RawMessage(`{"prompt":"cafe"}`)})
	if err != nil || out.(engine.Wait).After != time.Second {
		t.Fatalf("%+v %v", out, err)
	}
}
