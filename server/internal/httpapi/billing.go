package httpapi

import (
	"context"
	"net/http"
	"strconv"

	"nori/studio/server/internal/accounts"
	"nori/studio/server/internal/billing"
	"nori/studio/server/internal/platform/apperr"
)

type BillingService interface {
	Mode() string
	Packs() []billing.Pack
	Wallet(context.Context, string) (billing.Wallet, error)
	Checkout(context.Context, string, string, string) (billing.Purchase, error)
	Purchase(context.Context, string, string) (billing.Purchase, error)
	Purchases(context.Context, string, billing.ListParams) (billing.Page[billing.Purchase], error)
	Entries(context.Context, string, billing.ListParams) (billing.Page[billing.Entry], error)
	Simulate(context.Context, string, string, string) (billing.Purchase, error)
}
type billingHandlers struct {
	service BillingService
	respond *responder
}

func (h billingHandlers) routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/v1/billing/packs", h.handle(h.packs))
	mux.HandleFunc("GET /api/v1/billing/wallet", h.handle(h.wallet))
	mux.HandleFunc("POST /api/v1/billing/checkouts", h.handle(h.checkout))
	mux.HandleFunc("GET /api/v1/billing/purchases", h.handle(h.purchases))
	mux.HandleFunc("GET /api/v1/billing/purchases/{purchaseId}", h.handle(h.purchase))
	mux.HandleFunc("GET /api/v1/billing/entries", h.handle(h.entries))
	if h.service.Mode() == "fake" {
		mux.HandleFunc("POST /api/v1/billing/purchases/{purchaseId}/simulate", h.handle(h.simulate))
	}
}
func (h billingHandlers) handle(next func(http.ResponseWriter, *http.Request, string)) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		user, ok := accounts.UserFromContext(req.Context())
		if !ok {
			writeError(w, 401, "unauthenticated", "Sign in to continue.")
			return
		}
		next(w, req, user.ID)
	}
}
func (h billingHandlers) packs(w http.ResponseWriter, req *http.Request, _ string) {
	writeJSON(w, 200, struct {
		Mode  string         `json:"mode"`
		Packs []billing.Pack `json:"packs"`
	}{h.service.Mode(), h.service.Packs()})
}
func (h billingHandlers) wallet(w http.ResponseWriter, req *http.Request, owner string) {
	v, err := h.service.Wallet(req.Context(), owner)
	if err != nil {
		h.respond.error(w, err)
		return
	}
	writeJSON(w, 200, v)
}
func (h billingHandlers) checkout(w http.ResponseWriter, req *http.Request, owner string) {
	in, err := decodeObject[struct {
		PackID string `json:"packId"`
	}](w, req)
	if err != nil {
		h.respond.error(w, err)
		return
	}
	p, err := h.service.Checkout(req.Context(), owner, req.Header.Get("Idempotency-Key"), in.PackID)
	if err != nil {
		h.respond.error(w, err)
		return
	}
	w.Header().Set("Location", "/api/v1/billing/purchases/"+p.ID)
	writeJSON(w, http.StatusCreated, p)
}
func (h billingHandlers) purchase(w http.ResponseWriter, req *http.Request, owner string) {
	id, err := pathID(req, "purchaseId", "purchase")
	if err != nil {
		h.respond.error(w, err)
		return
	}
	p, err := h.service.Purchase(req.Context(), owner, id)
	if err != nil {
		h.respond.error(w, err)
		return
	}
	writeJSON(w, 200, p)
}
func billingList(req *http.Request) (billing.ListParams, error) {
	p := billing.ListParams{Cursor: req.URL.Query().Get("cursor")}
	if req.URL.Query().Has("limit") {
		n, err := strconv.Atoi(req.URL.Query().Get("limit"))
		if err != nil || n < 1 || n > 100 {
			return p, &apperr.ValidationError{Message: "limit must be between 1 and 100"}
		}
		p.Limit = n
	}
	return p, nil
}
func (h billingHandlers) purchases(w http.ResponseWriter, req *http.Request, owner string) {
	p, err := billingList(req)
	if err != nil {
		h.respond.error(w, err)
		return
	}
	page, err := h.service.Purchases(req.Context(), owner, p)
	if err != nil {
		h.respond.error(w, err)
		return
	}
	writeJSON(w, 200, page)
}
func (h billingHandlers) entries(w http.ResponseWriter, req *http.Request, owner string) {
	p, err := billingList(req)
	if err != nil {
		h.respond.error(w, err)
		return
	}
	page, err := h.service.Entries(req.Context(), owner, p)
	if err != nil {
		h.respond.error(w, err)
		return
	}
	writeJSON(w, 200, page)
}
func (h billingHandlers) simulate(w http.ResponseWriter, req *http.Request, owner string) {
	id, err := pathID(req, "purchaseId", "purchase")
	if err != nil {
		h.respond.error(w, err)
		return
	}
	in, err := decodeObject[struct {
		Action string `json:"action"`
	}](w, req)
	if err != nil {
		h.respond.error(w, err)
		return
	}
	p, err := h.service.Simulate(req.Context(), owner, id, in.Action)
	if err != nil {
		h.respond.error(w, err)
		return
	}
	writeJSON(w, 200, p)
}
