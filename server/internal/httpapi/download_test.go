package httpapi

import (
	"encoding/base64"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestDownloadCapabilities(t *testing.T) {
	signer, err := NewDownloadSigner([]byte(strings.Repeat("a", 32)))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := NewDownloadSigner([]byte("short")); err == nil {
		t.Fatal("accepted short signing key")
	}
	const owner = "10000000-0000-4000-8000-000000000001"
	const file = "20000000-0000-4000-8000-000000000001"
	link, _ := signer.URL(owner, file)
	u, err := url.Parse(link)
	if err != nil {
		t.Fatal(err)
	}
	token := u.Query().Get("token")
	if got, ok := signer.verify(file, token); !ok || got != owner {
		t.Fatal("valid capability rejected")
	}
	for _, tc := range []struct{ file, token string }{{file, token + "x"}, {"30000000-0000-4000-8000-000000000001", token}, {file, ""}, {file, strings.Repeat("a", 1025)}} {
		if _, ok := signer.verify(tc.file, tc.token); ok {
			t.Fatal("invalid capability accepted")
		}
	}
	for _, expires := range []int64{time.Now().Add(-time.Second).Unix(), time.Now().Add(10 * time.Minute).Unix()} {
		payload := base64.RawURLEncoding.EncodeToString([]byte(owner + "|" + file + "|" + strconv.FormatInt(expires, 10)))
		token := payload + "." + base64.RawURLEncoding.EncodeToString(signer.signature(payload))
		if _, ok := signer.verify(file, token); ok {
			t.Fatal("expired or overlong capability accepted")
		}
	}
	other, _ := NewDownloadSigner([]byte(strings.Repeat("b", 32)))
	if _, ok := other.verify(file, token); ok {
		t.Fatal("wrong signing key accepted")
	}
}
