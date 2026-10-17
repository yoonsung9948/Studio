package video

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"path/filepath"
	"testing"
	"time"

	"nori/studio/server/internal/engine"
	"nori/studio/server/internal/platform/blob"
	"nori/studio/server/internal/providers"
	"nori/studio/server/internal/providers/fake"
)

func newOp(t *testing.T, model providers.VideoModel) (*Operation, *blob.Local) {
	t.Helper()
	store, err := blob.NewLocal(filepath.Join(t.TempDir(), "blobs"))
	if err != nil {
		t.Fatal(err)
	}
	return NewOperation(model, store, time.Second), store
}

func TestCanonicalize(t *testing.T) {
	op, _ := newOp(t, &fake.Video{})
	got, err := op.Canonicalize(json.RawMessage(`{"prompt":"  dogs dancing  ","durationSeconds":6}`))
	if err != nil || string(got) != `{"prompt":"dogs dancing","durationSeconds":6,"resolution":"768P"}` {
		t.Fatalf("got %s %v", got, err)
	}
	for _, in := range []string{
		`{"prompt":" ","durationSeconds":6}`,
		`{"prompt":"x","durationSeconds":3}`,
		`{"prompt":"x","durationSeconds":16}`,
		`{"prompt":"x","durationSeconds":6,"resolution":"1080P"}`,
		`{"prompt":"x","durationSeconds":6,"extra":1}`,
		`{"prompt":"x"}`,
	} {
		if _, err := op.Canonicalize(json.RawMessage(in)); err == nil {
			t.Errorf("accepted %s", in)
		}
	}
}

func TestStepsGenerateAndStore(t *testing.T) {
	now := time.Unix(1000, 0)
	op, store := newOp(t, &fake.Video{Delay: 5 * time.Second, Sample: []byte("clip"), Now: func() time.Time { return now }})
	ctx := context.Background()
	run := engine.Run{JobID: "job-1", Input: json.RawMessage(`{"prompt":"dogs","durationSeconds":6,"resolution":"768P"}`)}

	out, err := op.Step(ctx, run)
	next, ok := out.(engine.Next)
	if err != nil || !ok || next.Step != stepPoll {
		t.Fatalf("submit: %+v %v", out, err)
	}
	run.Step, run.State = next.Step, next.State

	if out, err := op.Step(ctx, run); err != nil || !isWait(out, time.Second) {
		t.Fatalf("poll while pending: %+v %v", out, err)
	}
	now = now.Add(5 * time.Second)
	out, err = op.Step(ctx, run)
	next, ok = out.(engine.Next)
	if err != nil || !ok || next.Step != stepDownload {
		t.Fatalf("poll when done: %+v %v", out, err)
	}
	run.Step, run.State = next.Step, next.State

	out, err = op.Step(ctx, run)
	done, ok := out.(engine.Done)
	if err != nil || !ok || len(done.Artifacts) != 1 || done.Artifacts[0].Kind != "video" || done.Provider != "fake_minimax" {
		t.Fatalf("download: %+v %v", out, err)
	}
	var result Result
	if err := json.Unmarshal(done.Artifacts[0].Content, &result); err != nil {
		t.Fatal(err)
	}
	if result.FileKey != "jobs/job-1/video.mp4" || result.ContentType != "video/mp4" || result.SizeBytes != 4 || result.Prompt != "dogs" || result.ProviderTaskID == "" {
		t.Fatalf("result: %+v", result)
	}
	file, err := store.Open(ctx, result.FileKey)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	if data, _ := io.ReadAll(file); string(data) != "clip" {
		t.Fatalf("stored %q", data)
	}
}

// failingModel returns err from Submit and a failed task from Check.
type failingModel struct {
	fake.Video
	err error
}

func (m *failingModel) Submit(context.Context, providers.VideoRequest) (string, error) {
	return "", m.err
}

func (m *failingModel) Check(context.Context, string) (providers.VideoTask, error) {
	return providers.VideoTask{Status: providers.VideoFailed, Error: "content moderation"}, nil
}

func TestProviderFailures(t *testing.T) {
	input := json.RawMessage(`{"prompt":"dogs","durationSeconds":6,"resolution":"768P"}`)
	for _, tc := range []struct {
		err       error
		code      string
		retryable bool
	}{
		{providers.ErrRejected, "rejected", false},
		{providers.ErrUnauthorized, "provider_unauthorized", false},
		{errors.New("connection reset"), "provider_error", true},
	} {
		op, _ := newOp(t, &failingModel{err: tc.err})
		_, err := op.Step(context.Background(), engine.Run{Input: input})
		var runErr *engine.RunError
		if !errors.As(err, &runErr) || runErr.Code != tc.code || runErr.Retryable != tc.retryable {
			t.Errorf("%v: got %v", tc.err, err)
		}
	}

	op, _ := newOp(t, &failingModel{err: &providers.RateLimitedError{RetryAfter: 30 * time.Second}})
	if out, err := op.Step(context.Background(), engine.Run{Input: input}); err != nil || !isWait(out, 30*time.Second) {
		t.Errorf("rate limit: %+v %v", out, err)
	}

	op, _ = newOp(t, &failingModel{})
	_, err := op.Step(context.Background(), engine.Run{Input: input, Step: stepPoll, State: json.RawMessage(`{"taskId":"t1"}`)})
	var runErr *engine.RunError
	if !errors.As(err, &runErr) || runErr.Code != "generation_failed" || runErr.Retryable {
		t.Errorf("failed task: %v", err)
	}
}

func isWait(o engine.Outcome, after time.Duration) bool {
	w, ok := o.(engine.Wait)
	return ok && w.After == after && w.State == nil
}
