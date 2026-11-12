package httpapi

import (
	"context"
	"net/http"
	"strings"

	"nori/studio/server/internal/accounts"

	"github.com/clerk/clerk-sdk-go/v2"
	clerkhttp "github.com/clerk/clerk-sdk-go/v2/http"
	"github.com/clerk/clerk-sdk-go/v2/jwks"
)

type AccountService interface {
	Resolve(context.Context, accounts.Identity) (accounts.User, error)
}

// ClerkAuthentication verifies bearer tokens for this Clerk instance and frontend.
func ClerkAuthentication(secretKey, issuer string, authorizedParties []string) func(http.Handler) http.Handler {
	parties := make(map[string]bool, len(authorizedParties))
	for _, party := range authorizedParties {
		parties[party] = true
	}
	client := jwks.NewClient(&clerk.ClientConfig{
		BackendConfig: clerk.BackendConfig{
			Key: clerk.String(secretKey),
		},
	})
	return clerkAuthentication(issuer,
		clerkhttp.JWKSClient(client),
		clerkhttp.AuthorizedParty(func(party string) bool { return party != "" && parties[party] }),
	)
}

func clerkAuthentication(issuer string, options ...clerkhttp.AuthorizationOption) func(http.Handler) http.Handler {
	unauthorized := http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("WWW-Authenticate", "Bearer")
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Sign in to continue.")
	})
	options = append(options,
		clerkhttp.AuthorizationFailureHandler(unauthorized),
		clerkhttp.AuthorizationJWTExtractor(func(req *http.Request) string {
			parts := strings.Fields(req.Header.Get("Authorization"))
			if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
				return ""
			}
			return parts[1]
		}),
	)
	return func(next http.Handler) http.Handler {
		return clerkhttp.WithHeaderAuthorization(options...)(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			claims, ok := clerk.SessionClaimsFromContext(req.Context())
			if !ok || claims == nil || claims.Issuer != issuer || claims.Subject == "" || claims.SessionID == "" || claims.Expiry == nil {
				unauthorized.ServeHTTP(w, req)
				return
			}
			identity := accounts.Identity{Issuer: claims.Issuer, Subject: claims.Subject}
			ctx := accounts.WithIdentity(req.Context(), identity)
			next.ServeHTTP(w, req.WithContext(ctx))
		}))
	}
}

func requireAccount(service AccountService, authenticate func(http.Handler) http.Handler, respond *responder, next http.Handler) http.Handler {
	if service == nil || authenticate == nil {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			writeError(w, http.StatusServiceUnavailable, "authentication_unavailable", "Authentication is not configured.")
		})
	}
	return authenticate(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		identity, ok := accounts.IdentityFromContext(req.Context())
		if !ok {
			writeError(w, http.StatusUnauthorized, "unauthenticated", "Sign in to continue.")
			return
		}
		user, err := service.Resolve(req.Context(), identity)
		if err != nil {
			respond.error(w, err)
			return
		}
		next.ServeHTTP(w, req.WithContext(accounts.WithUser(req.Context(), user)))
	}))
}
