package httpapi

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"nori/studio/server/internal/engine"
)

type imageSubmissionStub struct {
	owner, key string
	input      engine.Submission
	calls      int
}

func (s *imageSubmissionStub) Submit(_ context.Context, owner, key string, input engine.Submission) (engine.Job, error) {
	s.owner, s.key, s.input = owner, key, input
	s.calls++
	return engine.Job{ID: "saved-job", Operation: input.Operation, Status: "queued"}, nil
}
func TestImageEndpoints(t *testing.T) {
	for _, tc := range []struct{ path, operation, body string }{
		{"generations", "generate_image", `{"prompt":"cafe","settings":{"aspectRatio":"16:9"}}`},
		{"edits", "edit_image", `{"prompt":"warmer","sourceAssetId":"00000000-0000-0000-0000-000000000001"}`},
	} {
		service := &imageSubmissionStub{}
		handler := New(Services{Accounts: &stubAccounts{}, Authenticate: testAuthentication, Images: service}, slog.New(slog.NewTextHandler(io.Discard, nil)), func(context.Context) error { return nil })
		req := httptest.NewRequest("POST", "/api/v1/images/"+tc.path, strings.NewReader(tc.body))
		req.Header.Set("Idempotency-Key", "image-key")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, req)
		if response.Code != 202 || response.Header().Get("Location") != "/api/v1/jobs/saved-job" || service.owner != "internal-user" || service.key != "image-key" || service.input.Operation != tc.operation {
			t.Fatalf("%d %s %+v", response.Code, response.Body, service)
		}
	}
}
func TestImageEndpointsRejectUntrustedFieldsAndAnonymousUsers(t *testing.T) {
	for _, body := range []string{`{"prompt":"cafe","ownerUserId":"other"}`, `{"prompt":"cafe","userId":"other"}`, `{"prompt":"cafe","storageKey":"private.png"}`, `{"prompt":"cafe"} {}`, `null`} {
		service := &imageSubmissionStub{}
		handler := New(Services{Accounts: &stubAccounts{}, Authenticate: testAuthentication, Images: service}, slog.Default(), func(context.Context) error { return nil })
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest("POST", "/api/v1/images/generations", strings.NewReader(body)))
		if response.Code != 400 || service.calls != 0 {
			t.Fatalf("accepted %s: %d", body, response.Code)
		}
	}
	service := &imageSubmissionStub{}
	handler := New(Services{Accounts: &stubAccounts{}, Images: service, Authenticate: func(next http.Handler) http.Handler { return next }}, slog.Default(), func(context.Context) error { return nil })
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest("POST", "/api/v1/images/edits", strings.NewReader(`{"prompt":"cafe"}`)))
	if response.Code != 401 || service.calls != 0 {
		t.Fatalf("anonymous request: %d", response.Code)
	}
}
