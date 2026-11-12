package httpapi

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"github.com/google/uuid"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const downloadLifetime = 5 * time.Minute

type DownloadSigner struct{ key []byte }

func NewDownloadSigner(key []byte) (*DownloadSigner, error) {
	if len(key) < 32 {
		return nil, fmt.Errorf("media signing key must contain at least 32 bytes")
	}
	return &DownloadSigner{key: append([]byte(nil), key...)}, nil
}
func (s *DownloadSigner) signature(payload string) []byte {
	h := hmac.New(sha256.New, s.key)
	h.Write([]byte("studio-download-v1:" + payload))
	return h.Sum(nil)
}
func (s *DownloadSigner) URL(ownerID, fileID string) (string, time.Time) {
	expires := time.Now().Add(downloadLifetime).Truncate(time.Second)
	payload := base64.RawURLEncoding.EncodeToString([]byte(ownerID + "|" + fileID + "|" + strconv.FormatInt(expires.Unix(), 10)))
	token := payload + "." + base64.RawURLEncoding.EncodeToString(s.signature(payload))
	return "/api/v1/downloads/" + fileID + "?token=" + token, expires
}
func (s *DownloadSigner) verify(fileID, token string) (string, bool) {
	if len(token) > 1024 {
		return "", false
	}
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return "", false
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || !hmac.Equal(signature, s.signature(parts[0])) {
		return "", false
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return "", false
	}
	fields := strings.Split(string(raw), "|")
	if len(fields) != 3 || fields[1] != fileID {
		return "", false
	}
	if _, err := uuid.Parse(fields[0]); err != nil {
		return "", false
	}
	expires, err := strconv.ParseInt(fields[2], 10, 64)
	now := time.Now().Unix()
	if err != nil || expires <= now || expires > now+int64(downloadLifetime/time.Second) {
		return "", false
	}
	return fields[0], true
}

func (h fileHandlers) signedFile(w http.ResponseWriter, req *http.Request) {
	id, err := pathID(req, "fileId", "file")
	if err != nil || h.signer == nil || h.assets == nil {
		writeError(w, 404, "not_found", "Resource not found.")
		return
	}
	owner, ok := h.signer.verify(id, req.URL.Query().Get("token"))
	if !ok {
		writeError(w, 404, "not_found", "Resource not found.")
		return
	}
	file, err := h.assets.File(req.Context(), owner, id)
	if err != nil {
		h.respond.error(w, err)
		return
	}
	h.serveFile(w, req, file.StorageKey)
}
