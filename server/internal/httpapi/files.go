package httpapi

import (
	"context"
	"errors"
	"net/http"
	"path"
	"time"

	"nori/studio/server/internal/accounts"
	"nori/studio/server/internal/platform/blob"
)

type FileStore interface {
	Open(ctx context.Context, key string) (blob.Object, error)
}

type fileHandlers struct {
	store   FileStore
	assets  AssetService
	signer  *DownloadSigner
	respond *responder
}

// fileWriteTimeout replaces the server's short write timeout for file
// downloads, which can take minutes on a slow connection.
const fileWriteTimeout = 10 * time.Minute

func (h fileHandlers) routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/v1/files/{key...}", h.getFile)
}

// getFile streams a stored file. It supports Range requests (video seeking),
// HEAD, and If-Modified-Since revalidation.
func (h fileHandlers) getFile(w http.ResponseWriter, req *http.Request) {
	user, ok := accounts.UserFromContext(req.Context())
	if !ok {
		writeError(w, 401, "unauthenticated", "Sign in to continue.")
		return
	}
	file, err := requireAssetFile(req.Context(), h.assets, user.ID, req.PathValue("key"))
	if err != nil {
		h.respond.error(w, err)
		return
	}
	h.serveFile(w, req, file.StorageKey)
}

func (h fileHandlers) serveFile(w http.ResponseWriter, req *http.Request, key string) {
	obj, err := h.store.Open(req.Context(), key)
	if errors.Is(err, blob.ErrNotFound) || errors.Is(err, blob.ErrInvalidKey) {
		writeError(w, http.StatusNotFound, "not_found", "Resource not found.")
		return
	}
	if err != nil {
		h.respond.error(w, err)
		return
	}
	defer obj.Close()
	if err := http.NewResponseController(w).SetWriteDeadline(time.Now().Add(fileWriteTimeout)); err != nil {
		h.respond.logger.Warn("cannot extend file write deadline", "error", err)
	}
	info := obj.Info()
	header := w.Header()
	header.Set("Content-Type", info.ContentType)
	// Files may be replaced under the same key, so clients revalidate before reuse.
	header.Set("Cache-Control", "private, no-store")
	// Treat any stored file as untrusted: never let it run scripts on this origin.
	header.Set("Content-Security-Policy", "sandbox")
	header.Set("Referrer-Policy", "no-referrer")
	http.ServeContent(w, req, path.Base(info.Key), info.ModTime, obj)
}
