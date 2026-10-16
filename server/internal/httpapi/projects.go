package httpapi

import (
	"context"
	"net/http"

	"nori/studio/server/internal/domain/project"
)

type ProjectService interface {
	Create(context.Context, string) (project.Project, error)
}

type projectHandlers struct {
	service ProjectService
	respond *responder
}

func (h projectHandlers) routes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/projects", h.createProject)
}

func (h projectHandlers) createProject(w http.ResponseWriter, req *http.Request) {
	var body struct {
		Title string `json:"title"`
	}
	if err := decode(w, req, &body); err != nil {
		h.respond.error(w, err)
		return
	}
	p, err := h.service.Create(req.Context(), body.Title)
	if err != nil {
		h.respond.error(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, p)
}
