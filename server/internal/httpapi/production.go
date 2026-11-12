package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"nori/studio/server/internal/accounts"
	"nori/studio/server/internal/platform/apperr"
	"nori/studio/server/internal/production"
)

func productionRoutes(mux *http.ServeMux, service *production.Service, respond *responder) {
	handle := func(w http.ResponseWriter, r *http.Request) {
		owner, ok := accounts.UserFromContext(r.Context())
		if !ok {
			writeError(w, 401, "unauthenticated", "Sign in to continue.")
			return
		}
		id, err := pathID(r, "projectId", "project")
		if err != nil {
			respond.error(w, err)
			return
		}
		if r.Pattern == "GET /api/v1/projects/{projectId}/generations" {
			items, err := service.ActiveJobs(r.Context(), owner.ID, id)
			if err != nil {
				respond.error(w, err)
				return
			}
			writeJSON(w, 200, items)
			return
		}
		if r.PathValue("shotId") != "" {
			var input production.GenerateInput
			if err := decodeLimit(w, r, &input, 512<<10); err != nil {
				respond.error(w, err)
				return
			}
			jobs, err := service.GenerateBatch(r.Context(), owner.ID, id, r.PathValue("shotId"), r.Header.Get("Idempotency-Key"), input)
			if err != nil {
				respond.error(w, err)
				return
			}
			writeJSON(w, 202, map[string]any{"jobs": jobs})
			return
		}
		if r.Method == "DELETE" {
			if err := service.Delete(r.Context(), owner.ID, id); err != nil {
				respond.error(w, err)
				return
			}
			w.WriteHeader(204)
			return
		}
		var document production.Document
		if r.Method == "PUT" {
			r.Body = http.MaxBytesReader(w, r.Body, 2<<20)
			decoder := json.NewDecoder(r.Body)
			decoder.DisallowUnknownFields()
			if decoder.Decode(&document) != nil || !errors.Is(decoder.Decode(new(any)), io.EOF) {
				respond.error(w, &apperr.ValidationError{Message: "Invalid production document"})
				return
			}
			document, err = service.Save(r.Context(), owner.ID, id, document)
		} else {
			document, err = service.Get(r.Context(), owner.ID, id)
		}
		if err != nil {
			respond.error(w, err)
			return
		}
		writeJSON(w, 200, document)
	}
	mux.HandleFunc("GET /api/v1/projects/{projectId}/generations", handle)
	mux.HandleFunc("POST /api/v1/projects/{projectId}/shots/{shotId}/generations", handle)
	mux.HandleFunc("GET /api/v1/projects/{projectId}/production", handle)
	mux.HandleFunc("PUT /api/v1/projects/{projectId}/production", handle)
	mux.HandleFunc("DELETE /api/v1/projects/{projectId}", handle)
}
