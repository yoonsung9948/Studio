package httpapi

import (
	"net/http"
	"nori/studio/server/internal/accounts"
)

func currentAccount(w http.ResponseWriter, req *http.Request) {
	user, ok := accounts.UserFromContext(req.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Sign in to continue.")
		return
	}
	writeJSON(w, http.StatusOK, user)
}
