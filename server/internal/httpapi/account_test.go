package httpapi

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	clerkhttp "github.com/clerk/clerk-sdk-go/v2/http"
	jose "github.com/go-jose/go-jose/v3"
	"nori/studio/server/internal/accounts"
)

type stubAccounts struct {
	calls    int
	identity accounts.Identity
	err      error
}

func (s *stubAccounts) Resolve(_ context.Context, identity accounts.Identity) (accounts.User, error) {
	s.calls++
	s.identity = identity
	return accounts.User{ID: "internal-user", DisplayName: "Nori", Status: "active"}, s.err
}

func TestCurrentAccountAuthentication(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	public, err := x509.MarshalPKIXPublicKey(&key.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	publicPEM := string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: public}))
	const issuer = "https://studio-test.clerk.accounts.dev"
	const party = "http://localhost:5173"
	auth := clerkAuthentication(issuer, clerkhttp.JSONWebKey(publicPEM), clerkhttp.AuthorizedParty(func(p string) bool { return p == party }))
	token := func(changes map[string]any, signingKey *rsa.PrivateKey) string {
		t.Helper()
		claims := map[string]any{"iss": issuer, "sub": "user_clerk", "sid": "sess_test", "azp": party, "exp": time.Now().Add(time.Minute).Unix(), "nbf": time.Now().Add(-time.Minute).Unix()}
		for k, v := range changes {
			claims[k] = v
		}
		data, err := json.Marshal(claims)
		if err != nil {
			t.Fatal(err)
		}
		signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: signingKey}, (&jose.SignerOptions{}).WithHeader("kid", "test-key"))
		if err != nil {
			t.Fatal(err)
		}
		object, err := signer.Sign(data)
		if err != nil {
			t.Fatal(err)
		}
		result, err := object.CompactSerialize()
		if err != nil {
			t.Fatal(err)
		}
		return result
	}
	otherKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name       string
		header     string
		accountErr error
		status     int
		calls      int
	}{
		{"valid", "Bearer " + token(nil, key), nil, 200, 1},
		{"missing", "", nil, 401, 0},
		{"malformed", "Bearer nonsense", nil, 401, 0},
		{"wrong scheme", "Basic " + token(nil, key), nil, 401, 0},
		{"expired", "Bearer " + token(map[string]any{"exp": time.Now().Add(-time.Minute).Unix()}, key), nil, 401, 0},
		{"future", "Bearer " + token(map[string]any{"nbf": time.Now().Add(time.Minute).Unix()}, key), nil, 401, 0},
		{"wrong issuer", "Bearer " + token(map[string]any{"iss": "https://another.clerk.accounts.dev"}, key), nil, 401, 0},
		{"wrong origin", "Bearer " + token(map[string]any{"azp": "https://other.example"}, key), nil, 401, 0},
		{"missing origin", "Bearer " + token(map[string]any{"azp": ""}, key), nil, 401, 0},
		{"missing subject", "Bearer " + token(map[string]any{"sub": ""}, key), nil, 401, 0},
		{"missing session", "Bearer " + token(map[string]any{"sid": ""}, key), nil, 401, 0},
		{"missing expiry", "Bearer " + token(map[string]any{"exp": nil}, key), nil, 401, 0},
		{"wrong signature", "Bearer " + token(nil, otherKey), nil, 401, 0},
		{"disabled", "Bearer " + token(nil, key), accounts.ErrDisabled, 403, 1},
		{"database error", "Bearer " + token(nil, key), errors.New("private database error"), 500, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			service := &stubAccounts{err: tc.accountErr}
			handler := New(Services{Accounts: service, Authenticate: auth}, slog.New(slog.NewTextHandler(io.Discard, nil)), func(context.Context) error { return nil })
			req := httptest.NewRequest("GET", "/api/v1/me", nil)
			req.Header.Set("Authorization", tc.header)
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, req)
			if w.Code != tc.status || service.calls != tc.calls {
				t.Fatalf("status=%d calls=%d body=%s", w.Code, service.calls, w.Body)
			}
			if tc.status == 200 {
				var user accounts.User
				if err := json.Unmarshal(w.Body.Bytes(), &user); err != nil {
					t.Fatal(err)
				}
				if user.ID != "internal-user" || service.identity.Issuer != issuer || service.identity.Subject != "user_clerk" {
					t.Fatalf("user=%+v identity=%+v", user, service.identity)
				}
			}
			if strings.Contains(w.Body.String(), "private database") {
				t.Fatal("internal error leaked")
			}
		})
	}
}

func TestCurrentAccountWithoutConfiguration(t *testing.T) {
	handler := New(Services{}, slog.Default(), func(context.Context) error { return nil })
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/me", nil))
	if w.Code != 503 {
		t.Fatalf("status=%d", w.Code)
	}
}
