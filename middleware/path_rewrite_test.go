package middleware

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestPathRewriteEscapedPath(t *testing.T) {
	for _, tc := range []struct{ path, old, new, route, want string }{
		{"/old/book%2Fpart", "/old", "/new", "/new/{id}", "/new/book%2Fpart"},
		{"/%6Fld/caf%C3%A9", "/old", "/new", "/new/{id}", "/new/caf%C3%A9"},
		{"/%6Fld/book", "/old", "/old", "/%6Fld/{id}", "/%6Fld/book"},
		{"/old/book%2Fpart", "/old", "/new name", "/new%20name/{id}", "/new%20name/book%2Fpart"},
	} {
		r := chi.NewRouter()
		r.Use(PathRewrite(tc.old, tc.new))
		r.Get(tc.route, func(w http.ResponseWriter, r *http.Request) {
			_, _ = io.WriteString(w, r.URL.EscapedPath())
		})
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, tc.path, nil))
		if w.Code != http.StatusOK || w.Body.String() != tc.want {
			t.Errorf("rewrite %q to %q: got %d %q, want 200 %q", tc.path, tc.new, w.Code, w.Body, tc.want)
		}
	}
}

func TestPathRewrite(t *testing.T) {
	r := chi.NewRouter()
	r.Use(PathRewrite("/endpoint", "/v1/endpoint"))

	r.Get("/v1/endpoint", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("OK"))
	})

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/endpoint", nil)
	r.ServeHTTP(w, req)

	if w.Result().StatusCode != http.StatusOK {
		t.Errorf("path rewrite: unexpected response code: %v", w.Result().StatusCode)
	}
}
