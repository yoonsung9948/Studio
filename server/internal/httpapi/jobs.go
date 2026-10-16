package httpapi

import (
	"context"
	"net/http"

	"nori/studio/server/internal/engine"
)

type JobService interface {
	Submit(ctx context.Context, projectID, idempotencyKey string, s engine.Submission) (engine.Job, error)
	Get(ctx context.Context, id string) (engine.JobDetail, error)
}

type jobHandlers struct {
	service JobService
	respond *responder
}

func (h jobHandlers) routes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/projects/{projectId}/jobs", h.submitJob)
	mux.HandleFunc("GET /api/v1/jobs/{jobId}", h.getJob)
}

func (h jobHandlers) submitJob(w http.ResponseWriter, req *http.Request) {
	projectID, err := pathID(req, "projectId", "project")
	if err != nil {
		h.respond.error(w, err)
		return
	}
	var submission engine.Submission
	if err := decode(w, req, &submission); err != nil {
		h.respond.error(w, err)
		return
	}
	job, err := h.service.Submit(req.Context(), projectID, req.Header.Get("Idempotency-Key"), submission)
	if err != nil {
		h.respond.error(w, err)
		return
	}
	w.Header().Set("Location", "/api/v1/jobs/"+job.ID)
	writeJSON(w, http.StatusAccepted, job)
}

func (h jobHandlers) getJob(w http.ResponseWriter, req *http.Request) {
	id, err := pathID(req, "jobId", "job")
	if err != nil {
		h.respond.error(w, err)
		return
	}
	job, err := h.service.Get(req.Context(), id)
	if err != nil {
		h.respond.error(w, err)
		return
	}
	writeJSON(w, http.StatusOK, job)
}
