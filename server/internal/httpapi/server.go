package httpapi

import (
	"context"
	"log/slog"
	"net/http"
	"nori/studio/server/internal/assets"
	"nori/studio/server/internal/production"
	"nori/studio/server/internal/references"
	"strings"
	"time"
)

// Services are what the API's handlers call.
type Services struct {
	Media        *assets.MediaService
	References   *references.Service
	Production   *production.Service
	Billing      BillingService
	Characters   CharacterService
	Images       ImageJobService
	Requests     RequestService
	Projects     ProjectService
	Jobs         JobService
	Files        FileStore
	Assets       AssetService
	Downloads    *DownloadSigner
	Accounts     AccountService
	Authenticate func(http.Handler) http.Handler
}

// New returns the HTTP handler for the whole API.
// ready reports whether dependencies (the database) are reachable.
func New(s Services, logger *slog.Logger, ready func(context.Context) error) http.Handler {
	r := &responder{logger: logger}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, req *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("GET /readyz", readiness(ready))
	api := http.NewServeMux()
	api.HandleFunc("GET /api/v1/me", currentAccount)
	mux.Handle("/api/v1/", requireAccount(s.Accounts, s.Authenticate, r, api))
	projectHandlers{service: s.Projects, respond: r}.routes(api)
	if s.Production != nil {
		productionRoutes(api, s.Production, r)
	}
	requestHandlers{service: s.Requests, respond: r}.routes(api)
	jobHandlers{service: s.Jobs, respond: r}.routes(api)
	if s.References != nil {
		referenceRoutes(api, s.References, r)
	}
	if s.Media != nil {
		mediaRoutes(api, s.Media, r)
	}
	if s.Images != nil {
		imageHandlers{service: s.Images, respond: r}.routes(api)
	}
	if s.Characters != nil {
		characterHandlers{service: s.Characters, respond: r}.routes(api)
	}
	if s.Billing != nil {
		billingHandlers{service: s.Billing, respond: r}.routes(api)
	}
	files := fileHandlers{store: s.Files, assets: s.Assets, signer: s.Downloads, respond: r}
	files.routes(api)
	assetHandlers{service: s.Assets, signer: s.Downloads, respond: r}.routes(api)
	mux.HandleFunc("GET /api/v1/downloads/{fileId}", files.signedFile)
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		timeout := 10 * time.Second
		if req.Method == http.MethodPost && strings.HasSuffix(req.URL.Path, "/uploads") {
			timeout = 2 * time.Minute
		}
		ctx, cancel := context.WithTimeout(req.Context(), timeout)
		defer cancel()
		mux.ServeHTTP(w, req.WithContext(ctx))
	})
}

func readiness(ready func(context.Context) error) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		ctx, cancel := context.WithTimeout(req.Context(), time.Second)
		defer cancel()
		if err := ready(ctx); err != nil {
			writeError(w, http.StatusServiceUnavailable, "unavailable", "Database is unavailable.")
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
	}
}
