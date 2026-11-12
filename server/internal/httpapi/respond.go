package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"

	"github.com/google/uuid"
	"nori/studio/server/internal/accounts"
	"nori/studio/server/internal/platform/apperr"
)

type errorBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// responder maps errors from any package to HTTP responses.
type responder struct {
	logger *slog.Logger
}

func (r *responder) error(w http.ResponseWriter, err error) {
	var validation *apperr.ValidationError
	var conflict *apperr.ConflictError
	switch {
	case errors.Is(err, accounts.ErrDisabled):
		writeError(w, http.StatusForbidden, "account_disabled", "Your account is disabled.")
	case errors.As(err, &validation):
		writeError(w, http.StatusBadRequest, "invalid_request", validation.Message)
	case errors.Is(err, apperr.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "Resource not found.")
	case errors.As(err, &conflict):
		writeError(w, http.StatusConflict, conflict.Code, conflict.Message)
	default:
		r.logger.Error("request failed", "error", err)
		writeError(w, http.StatusInternalServerError, "internal_error", "Request could not be completed.")
	}
}

// pathID parses a UUID path parameter.
func pathID(req *http.Request, name, label string) (string, error) {
	id, err := uuid.Parse(req.PathValue(name))
	if err != nil {
		return "", &apperr.ValidationError{Message: "invalid " + label + " ID"}
	}
	return id.String(), nil
}

func decode(w http.ResponseWriter, req *http.Request, dst any) error {
	return decodeLimit(w, req, dst, 64<<10)
}
func decodeLimit(w http.ResponseWriter, req *http.Request, dst any, limit int64) error {
	req.Body = http.MaxBytesReader(w, req.Body, limit)
	decoder := json.NewDecoder(req.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		return &apperr.ValidationError{Message: "invalid JSON request"}
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return &apperr.ValidationError{Message: "request must contain one JSON object"}
	}
	return nil
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{"error": errorBody{Code: code, Message: message}})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func decodeObject[T any](w http.ResponseWriter, req *http.Request) (*T, error) {
	var in *T
	if err := decode(w, req, &in); err != nil {
		return nil, err
	}
	if in == nil {
		return nil, &apperr.ValidationError{Message: "request must contain a JSON object"}
	}
	return in, nil
}
