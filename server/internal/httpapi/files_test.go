package httpapi

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"nori/studio/server/internal/platform/blob"
)

func newFileAPI(t *testing.T) (http.Handler, string) {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "blobs")
	store, err := blob.NewLocal(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Put(context.Background(), "projects/p1/clip.mp4", strings.NewReader("0123456789")); err != nil {
		t.Fatal(err)
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	return New(Services{Files: store}, logger, func(context.Context) error { return nil }), dir
}

func serve(h http.Handler, method, path string, headers map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, nil)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	return w
}

func TestServeFile(t *testing.T) {
	api, _ := newFileAPI(t)
	w := serve(api, "GET", "/api/v1/files/projects/p1/clip.mp4", nil)
	if w.Code != 200 || w.Body.String() != "0123456789" {
		t.Fatalf("status=%d body=%q", w.Code, w.Body)
	}
	for header, want := range map[string]string{
		"Content-Type":            "video/mp4",
		"Content-Security-Policy": "sandbox",
		"Cache-Control":           "private, no-cache",
		"Accept-Ranges":           "bytes",
	} {
		if got := w.Header().Get(header); got != want {
			t.Errorf("%s = %q, want %q", header, got, want)
		}
	}
}

func TestServeFileRange(t *testing.T) {
	api, _ := newFileAPI(t)
	w := serve(api, "GET", "/api/v1/files/projects/p1/clip.mp4", map[string]string{"Range": "bytes=2-5"})
	if w.Code != http.StatusPartialContent || w.Body.String() != "2345" || w.Header().Get("Content-Range") != "bytes 2-5/10" {
		t.Fatalf("status=%d body=%q range=%q", w.Code, w.Body, w.Header().Get("Content-Range"))
	}
	w = serve(api, "HEAD", "/api/v1/files/projects/p1/clip.mp4", nil)
	if w.Code != 200 || w.Body.Len() != 0 || w.Header().Get("Content-Length") != "10" {
		t.Fatalf("HEAD status=%d len=%q", w.Code, w.Header().Get("Content-Length"))
	}
}

func TestServeFileNotFound(t *testing.T) {
	api, dir := newFileAPI(t)
	if err := os.WriteFile(filepath.Join(filepath.Dir(dir), "secret.txt"), []byte("secret"), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{
		"/api/v1/files/projects/p1/missing.mp4",
		"/api/v1/files/projects",
		"/api/v1/files/%2E%2E%2Fsecret.txt",
		"/api/v1/files/a%20b.mp4",
	} {
		w := serve(api, "GET", path, nil)
		if w.Code != http.StatusNotFound || strings.Contains(w.Body.String(), "secret") {
			t.Errorf("%s: status=%d body=%q", path, w.Code, w.Body)
		}
	}
}
