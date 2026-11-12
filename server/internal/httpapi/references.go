package httpapi

import (
	"net/http"

	"nori/studio/server/internal/accounts"
	refs "nori/studio/server/internal/references"
)

func referenceRoutes(mux *http.ServeMux, s *refs.Service, respond *responder) {
	handle := func(w http.ResponseWriter, r *http.Request) {
		user, ok := accounts.UserFromContext(r.Context())
		if !ok {
			writeError(w, 401, "unauthenticated", "Sign in to continue.")
			return
		}
		owner := user.ID
		kind, id := r.PathValue("kind"), r.PathValue("subjectId")
		var result any
		var err error
		switch {
		case r.Pattern == "POST /api/v1/references/{kind}/{subjectId}/uploads":
			var input refs.UploadInput
			if err = decodeLimit(w, r, &input, 128<<10); err == nil {
				result, err = s.Upload(r.Context(), owner, kind, id, r.Header.Get("Idempotency-Key"), input)
			}
		case r.PathValue("versionId") != "" && r.PathValue("view") != "":
			err = s.Select(r.Context(), owner, kind, id, r.PathValue("view"), r.PathValue("versionId"))
		case r.PathValue("versionId") != "":
			err = s.Reject(r.Context(), owner, kind, id, r.PathValue("versionId"))
		case r.Pattern == "POST /api/v1/references/{kind}/{subjectId}/generations":
			var input refs.GenerateInput
			if err = decodeLimit(w, r, &input, 128<<10); err == nil {
				result, err = s.Generate(r.Context(), owner, kind, id, r.Header.Get("Idempotency-Key"), input)
			}
		case r.Pattern == "GET /api/v1/references/{kind}/{subjectId}/versions":
			var items []refs.Version
			var next *string
			items, next, err = s.Versions(r.Context(), owner, kind, id, r.URL.Query().Get("cursor"))
			result = map[string]any{"items": items, "nextCursor": next}
		case r.Method == "DELETE":
			err = s.Delete(r.Context(), owner, kind, id)
		case r.Method == "POST" || r.Method == "PATCH":
			var input refs.Input
			if err = decodeLimit(w, r, &input, 128<<10); err == nil {
				if id == "" {
					result, err = s.Create(r.Context(), owner, kind, input)
				} else {
					result, err = s.Update(r.Context(), owner, kind, id, input)
				}
			}
		case id != "":
			result, err = s.Get(r.Context(), owner, kind, id)
		default:
			var items []refs.Subject
			var next *string
			items, next, err = s.List(r.Context(), owner, kind, r.URL.Query().Get("cursor"))
			result = map[string]any{"items": items, "nextCursor": next}
		}
		if err != nil {
			respond.error(w, err)
			return
		}
		if result == nil {
			w.WriteHeader(204)
			return
		}
		status := 200
		if r.Pattern == "POST /api/v1/references/{kind}/{subjectId}/generations" {
			status = 202
		}
		writeJSON(w, status, result)
	}
	for _, pattern := range []string{"POST /api/v1/references/{kind}/{subjectId}/uploads", "GET /api/v1/references/{kind}", "POST /api/v1/references/{kind}", "GET /api/v1/references/{kind}/{subjectId}", "PATCH /api/v1/references/{kind}/{subjectId}", "DELETE /api/v1/references/{kind}/{subjectId}", "POST /api/v1/references/{kind}/{subjectId}/generations", "GET /api/v1/references/{kind}/{subjectId}/versions", "PUT /api/v1/references/{kind}/{subjectId}/views/{view}/{versionId}", "POST /api/v1/references/{kind}/{subjectId}/versions/{versionId}/reject"} {
		mux.HandleFunc(pattern, handle)
	}
}
