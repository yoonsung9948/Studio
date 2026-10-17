package blob

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func newStore(t *testing.T) (*Local, string) {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "blobs")
	s, err := NewLocal(dir)
	if err != nil {
		t.Fatal(err)
	}
	return s, dir
}

func read(t *testing.T, s *Local, key string) string {
	t.Helper()
	obj, err := s.Open(context.Background(), key)
	if err != nil {
		t.Fatal(err)
	}
	defer obj.Close()
	data, err := io.ReadAll(obj)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func TestPutAndOpen(t *testing.T) {
	s, _ := newStore(t)
	info, err := s.Put(context.Background(), "projects/p1/jobs/j1/video.mp4", strings.NewReader("first"))
	if err != nil {
		t.Fatal(err)
	}
	if info.Size != 5 || info.ContentType != "video/mp4" || info.Key != "projects/p1/jobs/j1/video.mp4" {
		t.Fatalf("info: %+v", info)
	}
	if got := read(t, s, info.Key); got != "first" {
		t.Fatalf("got %q", got)
	}
	if _, err := s.Put(context.Background(), info.Key, strings.NewReader("second")); err != nil {
		t.Fatal(err)
	}
	if got := read(t, s, info.Key); got != "second" {
		t.Fatalf("overwrite: got %q", got)
	}
}

func TestOpenMissing(t *testing.T) {
	s, _ := newStore(t)
	if _, err := s.Open(context.Background(), "nope.mp4"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("got %v", err)
	}
	if _, err := s.Put(context.Background(), "dir/file.png", strings.NewReader("x")); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Open(context.Background(), "dir"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("directory opened: %v", err)
	}
}

func TestRejectsUnsafeKeys(t *testing.T) {
	s, dir := newStore(t)
	outside := filepath.Join(filepath.Dir(dir), "secret.txt")
	if err := os.WriteFile(outside, []byte("secret"), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"", "/abs.mp4", "a//b.mp4", "../secret.txt", "a/../../secret.txt", "./a.mp4", "a/", "a b.mp4", `a\b.mp4`, "é.mp4", strings.Repeat("a", 600)} {
		if _, err := s.Open(context.Background(), key); !errors.Is(err, ErrInvalidKey) {
			t.Errorf("Open(%q): %v", key, err)
		}
		if _, err := s.Put(context.Background(), key, strings.NewReader("x")); !errors.Is(err, ErrInvalidKey) {
			t.Errorf("Put(%q): %v", key, err)
		}
	}
}

func TestCancelledPutLeavesNothing(t *testing.T) {
	s, dir := newStore(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := s.Put(ctx, "a/video.mp4", strings.NewReader("data")); err == nil {
		t.Fatal("cancelled put succeeded")
	}
	entries, err := os.ReadDir(filepath.Join(dir, "a"))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("left files behind: %v", entries)
	}
}

func TestContentType(t *testing.T) {
	for key, want := range map[string]string{
		"v.mp4": "video/mp4", "V.MP4": "video/mp4", "f.png": "image/png", "a.wav": "audio/wav", "x.unknownext": "application/octet-stream",
	} {
		if got := ContentType(key); got != want {
			t.Errorf("%s: got %s, want %s", key, got, want)
		}
	}
}
