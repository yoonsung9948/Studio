package httpapi

import (
	"context"
	"net/http"
	"nori/studio/server/internal/accounts"
	"strconv"

	"nori/studio/server/internal/domain/project"
)

type ProjectService interface {
	Create(context.Context, string, string) (project.Project, error)
	Get(context.Context, string, string) (project.Project, error)
	List(context.Context, string, project.ListParams) (project.Page, error)
}

type projectHandlers struct {
	service ProjectService
	respond *responder
}

func (h projectHandlers) routes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/projects", h.createProject)
	mux.HandleFunc("GET /api/v1/projects", h.listProjects)
	mux.HandleFunc("GET /api/v1/projects/{id}", h.getProject)
}

func (h projectHandlers) createProject(w http.ResponseWriter, req *http.Request) {
	user, ok := accounts.UserFromContext(req.Context())
	if !ok {
		writeError(w, 401, "unauthenticated", "Sign in to continue.")
		return
	}
	var body struct {
		Title string `json:"title"`
	}
	if err := decode(w, req, &body); err != nil {
		h.respond.error(w, err)
		return
	}
	p, err := h.service.Create(req.Context(), user.ID, body.Title)
	if err != nil {
		h.respond.error(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, p)
}

func (h projectHandlers) listProjects(w http.ResponseWriter, req *http.Request) {
	user, ok := accounts.UserFromContext(req.Context())
	if !ok {
		writeError(w, 401, "unauthenticated", "Sign in to continue.")
		return
	}
	q := req.URL.Query()
	params := project.ListParams{Cursor: q.Get("cursor"), Search: q.Get("q")}
	if q.Has("limit") {
		n, err := strconv.Atoi(q.Get("limit"))
		if err != nil || n < 1 || n > 100 {
			writeError(w, 400, "invalid_request", "limit must be between 1 and 100")
			return
		}
		params.Limit = n
	}
	projects, err := h.service.List(req.Context(), user.ID, params)
	if err != nil {
		h.respond.error(w, err)
		return
	}
	writeJSON(w, http.StatusOK, projects)
}

func (h projectHandlers) getProject(w http.ResponseWriter, req *http.Request) {
	user, ok := accounts.UserFromContext(req.Context())
	if !ok {
		writeError(w, 401, "unauthenticated", "Sign in to continue.")
		return
	}
	id, err := pathID(req, "id", "project")
	if err != nil {
		h.respond.error(w, err)
		return
	}
	p, err := h.service.Get(req.Context(), user.ID, id)
	if err != nil {
		h.respond.error(w, err)
		return
	}
	writeJSON(w, http.StatusOK, p)
}
