package httpapi

import (
	"context"
	"encoding/json"
	"net/http"

	"nori/studio/server/internal/accounts"
	imageinput "nori/studio/server/internal/domain/image"
	"nori/studio/server/internal/engine"
	imageop "nori/studio/server/internal/engine/ops/image"
)

type ImageJobService interface {
	Submit(context.Context, string, string, engine.Submission) (engine.Job, error)
}

type imageHandlers struct {
	service ImageJobService
	respond *responder
}

func (h imageHandlers) routes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/images/generations", h.submit(imageop.GenerateName))
	mux.HandleFunc("POST /api/v1/images/edits", h.submit(imageop.EditName))
}
func (h imageHandlers) submit(operation string) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		user, ok := accounts.UserFromContext(req.Context())
		if !ok {
			writeError(w, 401, "unauthenticated", "Sign in to continue.")
			return
		}
		var body *struct {
			ProjectID *string `json:"projectId"`
			imageinput.Input
		}
		if err := decode(w, req, &body); err != nil {
			h.respond.error(w, err)
			return
		}
		if body == nil {
			writeError(w, http.StatusBadRequest, "invalid_request", "request must contain a JSON object")
			return
		}
		input, err := json.Marshal(body.Input)
		if err != nil {
			h.respond.error(w, err)
			return
		}
		job, err := h.service.Submit(req.Context(), user.ID, req.Header.Get("Idempotency-Key"), engine.Submission{ProjectID: body.ProjectID, Operation: operation, Input: input})
		if err != nil {
			h.respond.error(w, err)
			return
		}
		w.Header().Set("Location", "/api/v1/jobs/"+job.ID)
		writeJSON(w, http.StatusAccepted, struct {
			Job engine.Job `json:"job"`
		}{job})
	}
}
