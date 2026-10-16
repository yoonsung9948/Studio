package httpapi

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"nori/studio/server/internal/domain/project"
	"nori/studio/server/internal/engine"
	"nori/studio/server/internal/platform/apperr"
)

type stubBackend struct {
	err   error
	calls int
}

// stubBackend implements both ProjectService and JobService.
func (s *stubBackend) Create(context.Context, string) (project.Project, error) {
	s.calls++
	return project.Project{ID: "project"}, s.err
}
func (s *stubBackend) Submit(context.Context, string, string, engine.Submission) (engine.Job, error) {
	s.calls++
	return engine.Job{ID: "job", Status: "queued"}, s.err
}
func (s *stubBackend) Get(context.Context, string) (engine.JobDetail, error) {
	s.calls++
	return engine.JobDetail{}, s.err
}

func newAPI(backend *stubBackend, logger *slog.Logger, ready func(context.Context) error) http.Handler {
	return New(backend, backend, logger, ready)
}

func TestRequestValidation(t *testing.T) {
	cases := []struct{ name, path, body string }{
		{"unknown field", "/api/v1/projects", `{"title":"test","unexpected":true}`},
		{"trailing object", "/api/v1/projects", `{"title":"test"} {}`},
		{"malformed", "/api/v1/projects", `{`},
		{"oversized", "/api/v1/projects", `{"title":"` + strings.Repeat("a", 65536) + `"}`},
		{"bad project ID", "/api/v1/projects/invalid/jobs", `{}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			backend := &stubBackend{}
			api := newAPI(backend, slog.New(slog.NewTextHandler(io.Discard, nil)), func(context.Context) error { return nil })
			w := httptest.NewRecorder()
			api.ServeHTTP(w, httptest.NewRequest(http.MethodPost, tc.path, strings.NewReader(tc.body)))
			if w.Code != http.StatusBadRequest || backend.calls != 0 {
				t.Fatalf("status=%d calls=%d body=%s", w.Code, backend.calls, w.Body)
			}
		})
	}
}

func TestErrorMapping(t *testing.T) {
	for _, tc := range []struct {
		err    error
		status int
		code   string
	}{
		{apperr.ErrNotFound, 404, "not_found"},
		{engine.ErrIdempotencyConflict, 409, "idempotency_conflict"},
		{&apperr.ValidationError{Message: "bad input"}, 400, "invalid_request"},
		{errors.New("secret database details"), 500, "internal_error"},
	} {
		api := newAPI(&stubBackend{err: tc.err}, slog.New(slog.NewTextHandler(io.Discard, nil)), func(context.Context) error { return nil })
		w := httptest.NewRecorder()
		api.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/jobs/00000000-0000-0000-0000-000000000001", nil))
		if w.Code != tc.status || !strings.Contains(w.Body.String(), tc.code) {
			t.Fatalf("status=%d body=%s", w.Code, w.Body)
		}
		if strings.Contains(w.Body.String(), "secret") {
			t.Fatal("internal error leaked")
		}
	}
}

func TestReadiness(t *testing.T) {
	api := newAPI(&stubBackend{}, slog.Default(), func(context.Context) error { return errors.New("offline") })
	for _, tc := range []struct {
		path   string
		status int
	}{{"/healthz", 200}, {"/readyz", 503}} {
		w := httptest.NewRecorder()
		api.ServeHTTP(w, httptest.NewRequest("GET", tc.path, nil))
		if w.Code != tc.status {
			t.Fatalf("%s returned %d", tc.path, w.Code)
		}
	}
}

func TestSubmissionLocation(t *testing.T) {
	api := newAPI(&stubBackend{}, slog.Default(), func(context.Context) error { return nil })
	w := httptest.NewRecorder()
	api.ServeHTTP(w, httptest.NewRequest("POST", "/api/v1/projects/00000000-0000-0000-0000-000000000001/jobs", strings.NewReader(`{"operation":"interpret_brief","input":{"prompt":"story"}}`)))
	if w.Code != 202 || w.Header().Get("Location") != "/api/v1/jobs/job" {
		t.Fatalf("status=%d headers=%v", w.Code, w.Header())
	}
}
