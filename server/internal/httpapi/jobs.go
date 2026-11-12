package httpapi

import (
	"context"
	"net/http"
	"nori/studio/server/internal/accounts"
	"strconv"

	"nori/studio/server/internal/engine"
)

type JobService interface {
	Get(ctx context.Context, ownerID, id string) (engine.JobDetail, error)
	List(context.Context, string, engine.ListJobsParams) (engine.JobPage, error)
}

type jobHandlers struct {
	service JobService
	respond *responder
}

func (h jobHandlers) routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/v1/jobs/{jobId}", h.getJob)
	mux.HandleFunc("GET /api/v1/jobs", h.listJobs)
}

func (h jobHandlers) getJob(w http.ResponseWriter, req *http.Request) {
	user, ok := accounts.UserFromContext(req.Context())
	if !ok {
		writeError(w, 401, "unauthenticated", "Sign in to continue.")
		return
	}
	id, err := pathID(req, "jobId", "job")
	if err != nil {
		h.respond.error(w, err)
		return
	}
	job, err := h.service.Get(req.Context(), user.ID, id)
	if err != nil {
		h.respond.error(w, err)
		return
	}
	writeJSON(w, http.StatusOK, job)
}

func (h jobHandlers) listJobs(w http.ResponseWriter, req *http.Request) {
	user, ok := accounts.UserFromContext(req.Context())
	if !ok {
		writeError(w, 401, "unauthenticated", "Sign in to continue.")
		return
	}
	q := req.URL.Query()
	params := engine.ListJobsParams{Limit: engine.DefaultJobListLimit, Cursor: q.Get("cursor"), Status: q.Get("status"), Operation: q.Get("operation")}
	if q.Has("limit") {
		n, err := strconv.Atoi(q.Get("limit"))
		if err != nil || n < 1 || n > engine.MaxJobListLimit {
			writeError(w, http.StatusBadRequest, "invalid_request", "limit must be between 1 and 100")
			return
		}
		params.Limit = n
	}
	if q.Has("projectId") {
		id := q.Get("projectId")
		params.ProjectID = &id
	}
	page, err := h.service.List(req.Context(), user.ID, params)
	if err != nil {
		h.respond.error(w, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}
