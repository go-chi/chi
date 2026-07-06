package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestBasicAuthEscapesRealm(t *testing.T) {
	realm := `admin"ops\zone`
	h := BasicAuth(realm, map[string]string{"user": "pass"})(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {},
	))

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status code = %d, want %d", rr.Code, http.StatusUnauthorized)
	}

	const want = `Basic realm="admin\"ops\\zone"`
	if got := rr.Header().Get("WWW-Authenticate"); got != want {
		t.Fatalf("WWW-Authenticate = %q, want %q", got, want)
	}
}
