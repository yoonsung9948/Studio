package httpapi

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strconv"

	"github.com/google/uuid"
	"nori/studio/server/internal/accounts"
	"nori/studio/server/internal/characters"
	"nori/studio/server/internal/platform/apperr"
)

type CharacterService interface {
	Upload(context.Context, string, string, string, io.Reader) (characters.Version, error)
	Create(context.Context, string, characters.CreateInput) (characters.Detail, error)
	Get(context.Context, string, string) (characters.Detail, error)
	List(context.Context, string, characters.ListParams) (characters.Page[characters.Character], error)
	Update(context.Context, string, string, characters.UpdateInput) (characters.Detail, error)
	Delete(context.Context, string, string) error
	Generate(context.Context, string, string, string, characters.GenerateInput) (characters.Generation, error)
	Generation(context.Context, string, string, string) (characters.Generation, error)
	Versions(context.Context, string, string, characters.ListParams) (characters.Page[characters.Version], error)
	Select(context.Context, string, string, string, string) (characters.Detail, error)
	Reject(context.Context, string, string, string) error
}
type characterHandlers struct {
	service CharacterService
	respond *responder
}

func (h characterHandlers) routes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/characters", h.handle(h.create))
	mux.HandleFunc("GET /api/v1/characters", h.handle(h.list))
	mux.HandleFunc("GET /api/v1/characters/{characterId}", h.handle(h.get))
	mux.HandleFunc("PATCH /api/v1/characters/{characterId}", h.handle(h.update))
	mux.HandleFunc("DELETE /api/v1/characters/{characterId}", h.handle(h.delete))
	mux.HandleFunc("POST /api/v1/characters/{characterId}/uploads", h.handle(h.upload))
	mux.HandleFunc("POST /api/v1/characters/{characterId}/generations", h.handle(h.generate))
	mux.HandleFunc("GET /api/v1/characters/{characterId}/generations/{generationId}", h.handle(h.generation))
	mux.HandleFunc("GET /api/v1/characters/{characterId}/versions", h.handle(h.versions))
	mux.HandleFunc("PUT /api/v1/characters/{characterId}/views/{view}/selection", h.handle(h.selectVersion))
	mux.HandleFunc("POST /api/v1/characters/{characterId}/versions/{versionId}/reject", h.handle(h.reject))
}
func (h characterHandlers) handle(next func(http.ResponseWriter, *http.Request, string, string)) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		user, ok := accounts.UserFromContext(req.Context())
		if !ok {
			writeError(w, 401, "unauthenticated", "Sign in to continue.")
			return
		}
		var id string
		if req.PathValue("characterId") != "" {
			var err error
			id, err = pathID(req, "characterId", "character")
			if err != nil {
				h.respond.error(w, err)
				return
			}
		}
		next(w, req, user.ID, id)
	}
}

func characterListParams(req *http.Request) (characters.ListParams, error) {
	q := req.URL.Query()
	p := characters.ListParams{Cursor: q.Get("cursor"), Search: q.Get("q"), View: q.Get("view")}
	if q.Has("limit") {
		n, err := strconv.Atoi(q.Get("limit"))
		if err != nil || n < 1 || n > 100 {
			return p, &apperr.ValidationError{Message: "limit must be between 1 and 100"}
		}
		p.Limit = n
	}
	return p, nil
}
func (h characterHandlers) create(w http.ResponseWriter, req *http.Request, owner, _ string) {
	in, err := decodeObject[characters.CreateInput](w, req)
	if err != nil {
		h.respond.error(w, err)
		return
	}
	result, err := h.service.Create(req.Context(), owner, *in)
	if err != nil {
		h.respond.error(w, err)
		return
	}
	w.Header().Set("Location", "/api/v1/characters/"+result.ID)
	writeJSON(w, http.StatusCreated, result)
}
func (h characterHandlers) get(w http.ResponseWriter, req *http.Request, owner, id string) {
	result, err := h.service.Get(req.Context(), owner, id)
	if err != nil {
		h.respond.error(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
func (h characterHandlers) list(w http.ResponseWriter, req *http.Request, owner, _ string) {
	params, err := characterListParams(req)
	if err != nil {
		h.respond.error(w, err)
		return
	}
	result, err := h.service.List(req.Context(), owner, params)
	if err != nil {
		h.respond.error(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
func (h characterHandlers) update(w http.ResponseWriter, req *http.Request, owner, id string) {
	in, err := decodeObject[characters.UpdateInput](w, req)
	if err != nil {
		h.respond.error(w, err)
		return
	}
	result, err := h.service.Update(req.Context(), owner, id, *in)
	if err != nil {
		h.respond.error(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
func (h characterHandlers) delete(w http.ResponseWriter, req *http.Request, owner, id string) {
	if err := h.service.Delete(req.Context(), owner, id); err != nil {
		h.respond.error(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (h characterHandlers) generate(w http.ResponseWriter, req *http.Request, owner, id string) {
	in, err := decodeObject[characters.GenerateInput](w, req)
	if err != nil {
		h.respond.error(w, err)
		return
	}
	result, err := h.service.Generate(req.Context(), owner, id, req.Header.Get("Idempotency-Key"), *in)
	if err != nil {
		h.respond.error(w, err)
		return
	}
	w.Header().Set("Location", "/api/v1/characters/"+id+"/generations/"+result.ID)
	writeJSON(w, http.StatusAccepted, result)
}
func (h characterHandlers) generation(w http.ResponseWriter, req *http.Request, owner, id string) {
	batchID, err := pathID(req, "generationId", "generation")
	if err != nil {
		h.respond.error(w, err)
		return
	}
	result, err := h.service.Generation(req.Context(), owner, id, batchID)
	if err != nil {
		h.respond.error(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
func (h characterHandlers) versions(w http.ResponseWriter, req *http.Request, owner, id string) {
	params, err := characterListParams(req)
	if err != nil {
		h.respond.error(w, err)
		return
	}
	result, err := h.service.Versions(req.Context(), owner, id, params)
	if err != nil {
		h.respond.error(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
func (h characterHandlers) selectVersion(w http.ResponseWriter, req *http.Request, owner, id string) {
	in, err := decodeObject[struct {
		VersionID string `json:"versionId"`
	}](w, req)
	if err != nil {
		h.respond.error(w, err)
		return
	}
	versionID, err := uuid.Parse(in.VersionID)
	if err != nil {
		h.respond.error(w, &apperr.ValidationError{Message: "invalid version ID"})
		return
	}
	result, err := h.service.Select(req.Context(), owner, id, req.PathValue("view"), versionID.String())
	if err != nil {
		h.respond.error(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
func (h characterHandlers) reject(w http.ResponseWriter, req *http.Request, owner, id string) {
	versionID, err := pathID(req, "versionId", "version")
	if err != nil {
		h.respond.error(w, err)
		return
	}
	if err := h.service.Reject(req.Context(), owner, id, versionID); err != nil {
		h.respond.error(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// The body is raw image bytes; filenames and browser MIME declarations are ignored.
func (h characterHandlers) upload(w http.ResponseWriter, req *http.Request, owner, id string) {
	req.Body = http.MaxBytesReader(w, req.Body, characters.MaxUploadBytes)
	version, err := h.service.Upload(req.Context(), owner, id, req.Header.Get("Idempotency-Key"), req.Body)
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeError(w, http.StatusRequestEntityTooLarge, "invalid_request", "image must be at most 5 MiB")
			return
		}
		h.respond.error(w, err)
		return
	}
	w.Header().Set("Location", "/api/v1/characters/"+id+"/versions")
	writeJSON(w, http.StatusCreated, version)
}
