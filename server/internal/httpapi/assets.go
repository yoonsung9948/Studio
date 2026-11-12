package httpapi

import (
	"context"
	"net/http"
	"nori/studio/server/internal/accounts"
	"nori/studio/server/internal/assets"
	"nori/studio/server/internal/platform/apperr"
	"strconv"
)

type AssetService interface {
	Get(context.Context, string, string) (assets.Detail, error)
	List(context.Context, string, assets.ListParams) (assets.Page, error)
	File(context.Context, string, string) (assets.File, error)
	FileByKey(context.Context, string, string) (assets.File, error)
}
type assetHandlers struct {
	service AssetService
	signer  *DownloadSigner
	respond *responder
}

func (h assetHandlers) routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/v1/assets", h.list)
	mux.HandleFunc("GET /api/v1/assets/{assetId}", h.get)
	mux.HandleFunc("GET /api/v1/asset-files/{fileId}/url", h.downloadURL)
}
func (h assetHandlers) get(w http.ResponseWriter, req *http.Request) {
	id, err := pathID(req, "assetId", "asset")
	if err != nil {
		h.respond.error(w, err)
		return
	}
	user, _ := accounts.UserFromContext(req.Context())
	d, err := h.service.Get(req.Context(), user.ID, id)
	if err != nil {
		h.respond.error(w, err)
		return
	}
	writeJSON(w, 200, d)
}
func (h assetHandlers) list(w http.ResponseWriter, req *http.Request) {
	user, _ := accounts.UserFromContext(req.Context())
	q := req.URL.Query()
	p := assets.ListParams{Cursor: q.Get("cursor"), Kind: q.Get("kind")}
	if q.Has("limit") {
		n, err := strconv.Atoi(q.Get("limit"))
		if err != nil || n < 1 || n > 100 {
			writeError(w, 400, "invalid_request", "limit must be between 1 and 100")
			return
		}
		p.Limit = n
	}
	if q.Has("projectId") {
		id := q.Get("projectId")
		p.ProjectID = &id
	}
	page, err := h.service.List(req.Context(), user.ID, p)
	if err != nil {
		h.respond.error(w, err)
		return
	}
	writeJSON(w, 200, page)
}
func (h assetHandlers) downloadURL(w http.ResponseWriter, req *http.Request) {
	id, err := pathID(req, "fileId", "file")
	if err != nil {
		h.respond.error(w, err)
		return
	}
	user, _ := accounts.UserFromContext(req.Context())
	_, err = h.service.File(req.Context(), user.ID, id)
	if err != nil {
		h.respond.error(w, err)
		return
	}
	if h.signer == nil {
		writeError(w, 503, "unavailable", "Media downloads are unavailable.")
		return
	}
	url, expires := h.signer.URL(user.ID, id)
	writeJSON(w, 200, map[string]any{"url": url, "expiresAt": expires})
}

func requireAssetFile(ctx context.Context, service AssetService, ownerID, key string) (assets.File, error) {
	if service == nil {
		return assets.File{}, apperr.ErrNotFound
	}
	return service.FileByKey(ctx, ownerID, key)
}
