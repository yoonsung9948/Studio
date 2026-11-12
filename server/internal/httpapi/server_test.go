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

	"nori/studio/server/internal/accounts"
	"nori/studio/server/internal/domain/project"
	"nori/studio/server/internal/engine"
	"nori/studio/server/internal/platform/apperr"
	"nori/studio/server/internal/requests"
)

type stubBackend struct {
	err   error
	calls int
}

type stubProjects struct{ backend *stubBackend }

func (s stubProjects) Create(context.Context, string, string) (project.Project, error) {
	s.backend.calls++
	return project.Project{ID: "project"}, s.backend.err
}

type stubRequests struct{ backend *stubBackend }

func (s stubRequests) Submit(context.Context, string, string, requests.Submission) (requests.Accepted, error) {
	s.backend.calls++
	return requests.Accepted{Request: requests.Request{ID: "request"}, Job: engine.Job{ID: "job", Status: "queued"}}, s.backend.err
}
func (s stubRequests) Get(context.Context, string, string) (requests.Request, error) {
	s.backend.calls++
	return requests.Request{}, s.backend.err
}
func (s *stubBackend) Get(context.Context, string, string) (engine.JobDetail, error) {
	s.calls++
	return engine.JobDetail{}, s.err
}

func (s stubProjects) Get(context.Context, string, string) (project.Project, error) {
	s.backend.calls++
	return project.Project{}, s.backend.err
}
func (s stubProjects) List(context.Context, string, project.ListParams) (project.Page, error) {
	s.backend.calls++
	return project.Page{Items: []project.Project{}}, s.backend.err
}
func (s *stubBackend) List(context.Context, string, engine.ListJobsParams) (engine.JobPage, error) {
	s.calls++
	return engine.JobPage{Items: []engine.Job{}}, s.err
}

func newAPI(backend *stubBackend, logger *slog.Logger, ready func(context.Context) error) http.Handler {
	return New(Services{Accounts: &stubAccounts{}, Authenticate: testAuthentication, Projects: stubProjects{backend}, Jobs: backend, Requests: stubRequests{backend}}, logger, ready)
}

func TestRequestValidation(t *testing.T) {
	cases := []struct{ name, path, body string }{
		{"unknown field", "/api/v1/projects", `{"title":"test","unexpected":true}`},
		{"trailing object", "/api/v1/projects", `{"title":"test"} {}`},
		{"malformed", "/api/v1/projects", `{`},
		{"oversized", "/api/v1/projects", `{"title":"` + strings.Repeat("a", 65536) + `"}`},
		{"bad JSON", "/api/v1/requests", `{`},
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
	api.ServeHTTP(w, httptest.NewRequest("POST", "/api/v1/requests", strings.NewReader(`{"prompt":"story"}`)))
	if w.Code != 202 || w.Header().Get("Location") != "/api/v1/requests/request" {
		t.Fatalf("status=%d headers=%v", w.Code, w.Header())
	}
}

func TestJobSubmissionIsInternal(t *testing.T) {
	backend := &stubBackend{}
	api := newAPI(backend, slog.Default(), func(context.Context) error { return nil })
	w := httptest.NewRecorder()
	api.ServeHTTP(w, httptest.NewRequest("POST", "/api/v1/jobs", strings.NewReader(`{}`)))
	if w.Code != 405 || backend.calls != 0 {
		t.Fatalf("status=%d calls=%d", w.Code, backend.calls)
	}
}

func testAuthentication(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		next.ServeHTTP(w, req.WithContext(accounts.WithIdentity(req.Context(), accounts.Identity{Issuer: "test", Subject: "default"})))
	})
}
