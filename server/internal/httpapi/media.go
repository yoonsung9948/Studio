package httpapi

import (
	"net/http"

	"nori/studio/server/internal/accounts"
	"nori/studio/server/internal/assets"
)

func mediaRoutes(mux *http.ServeMux, s *assets.MediaService, r *responder) {
	mux.HandleFunc("POST /api/v1/assets/uploads", func(w http.ResponseWriter, req *http.Request) {
		user, ok := accounts.UserFromContext(req.Context())
		if !ok {
			writeError(w, 401, "unauthenticated", "Sign in to continue.")
			return
		}
		var project *string
		if id := req.URL.Query().Get("projectId"); id != "" {
			project = &id
		}
		req.Body = http.MaxBytesReader(w, req.Body, assets.MaxMediaBytes)
		result, err := s.Upload(req.Context(), user.ID, req.Header.Get("Idempotency-Key"), project, req.Body)
		if err != nil {
			r.error(w, err)
			return
		}
		writeJSON(w, 201, result)
	})
	mux.HandleFunc("DELETE /api/v1/assets/{assetId}", func(w http.ResponseWriter, req *http.Request) {
		user, ok := accounts.UserFromContext(req.Context())
		if !ok {
			writeError(w, 401, "unauthenticated", "Sign in to continue.")
			return
		}
		id, err := pathID(req, "assetId", "asset")
		if err == nil {
			err = s.Delete(req.Context(), user.ID, id)
		}
		if err != nil {
			r.error(w, err)
			return
		}
		w.WriteHeader(204)
	})
}
