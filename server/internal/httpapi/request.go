package httpapi

import (
	"context"
	"net/http"
	"nori/studio/server/internal/accounts"
	"nori/studio/server/internal/requests"
)

type RequestService interface {
	Submit(context.Context, string, string, requests.Submission) (requests.Accepted, error)
	Get(context.Context, string, string) (requests.Request, error)
}

type requestHandlers struct {
	service RequestService
	respond *responder
}

func (h requestHandlers) routes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/requests", h.submitRequest)
	mux.HandleFunc("GET /api/v1/requests/{requestId}", h.getRequest)
}

func (h requestHandlers) submitRequest(w http.ResponseWriter, req *http.Request) {
	user, ok := accounts.UserFromContext(req.Context())
	if !ok {
		writeError(w, 401, "unauthenticated", "Sign in to continue.")
		return
	}
	var input requests.Submission
	if err := decode(w, req, &input); err != nil {
		h.respond.error(w, err)
		return
	}
	accepted, err := h.service.Submit(req.Context(), user.ID, req.Header.Get("Idempotency-Key"), input)
	if err != nil {
		h.respond.error(w, err)
		return
	}
	w.Header().Set("Location", "/api/v1/requests/"+accepted.Request.ID)
	writeJSON(w, http.StatusAccepted, accepted)
}

func (h requestHandlers) getRequest(w http.ResponseWriter, req *http.Request) {
	user, ok := accounts.UserFromContext(req.Context())
	if !ok {
		writeError(w, 401, "unauthenticated", "Sign in to continue.")
		return
	}
	id, err := pathID(req, "requestId", "request")
	if err != nil {
		h.respond.error(w, err)
		return
	}
	result, err := h.service.Get(req.Context(), user.ID, id)
	if err != nil {
		h.respond.error(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
