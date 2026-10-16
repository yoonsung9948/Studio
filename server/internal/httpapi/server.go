package httpapi

import (
	"context"
	"log/slog"
	"net/http"
	"time"
)

// New returns the HTTP handler for the whole API.
// ready reports whether dependencies (the database) are reachable.
func New(projects ProjectService, jobs JobService, logger *slog.Logger, ready func(context.Context) error) http.Handler {
	r := &responder{logger: logger}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, req *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("GET /readyz", readiness(ready))
	projectHandlers{service: projects, respond: r}.routes(mux)
	jobHandlers{service: jobs, respond: r}.routes(mux)
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		ctx, cancel := context.WithTimeout(req.Context(), 10*time.Second)
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
