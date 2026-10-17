package fake

import (
	"context"
	"errors"
	"io"
	"testing"
	"time"

	"nori/studio/server/internal/providers"
)

func TestVideoLifecycle(t *testing.T) {
	now := time.Unix(1000, 0)
	v := &Video{Delay: 5 * time.Second, Sample: []byte("clip"), Now: func() time.Time { return now }}
	ctx := context.Background()
	id, err := v.Submit(ctx, providers.VideoRequest{Prompt: "dogs dancing", DurationSeconds: 6, Resolution: "768P"})
	if err != nil {
		t.Fatal(err)
	}
	if task, _ := v.Check(ctx, id); task.Status != providers.VideoPending {
		t.Fatalf("got %+v before the delay", task)
	}
	now = now.Add(5 * time.Second)
	task, err := v.Check(ctx, id)
	if err != nil || task.Status != providers.VideoSucceeded || task.File == "" {
		t.Fatalf("got %+v %v after the delay", task, err)
	}
	rc, err := v.Download(ctx, task.File)
	if err != nil {
		t.Fatal(err)
	}
	defer rc.Close()
	if data, _ := io.ReadAll(rc); string(data) != "clip" {
		t.Fatalf("downloaded %q", data)
	}
}

func TestVideoRejectsAndUnknownTasks(t *testing.T) {
	v := &Video{}
	if _, err := v.Submit(context.Background(), providers.VideoRequest{Prompt: " "}); !errors.Is(err, providers.ErrRejected) {
		t.Fatalf("got %v", err)
	}
	if task, _ := v.Check(context.Background(), "someone-else"); task.Status != providers.VideoFailed {
		t.Fatalf("got %+v", task)
	}
	rc, _ := v.Download(context.Background(), "x")
	if data, _ := io.ReadAll(rc); string(data) != string(Placeholder) {
		t.Fatal("expected placeholder without a sample")
	}
}
