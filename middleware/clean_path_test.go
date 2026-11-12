package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestCleanPath(t *testing.T) {
	r := chi.NewRouter()
	r.Use(CleanPath)
	r.Get("/users/1", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) }))

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/users////1", nil)
	r.ServeHTTP(w, req)

	if w.Result().StatusCode != http.StatusOK {
		t.Errorf("clean path: unexpected response code: %v", w.Result().StatusCode)
	}
}

// This tests CleanPath used on a plain http.Handler that is not a chi.Router.
// In these cases there is no routing context on the request, so CleanPath must
// fall back to rewriting the request path directly instead of panicking.
func TestCleanPathWithNilContext(t *testing.T) {
	var gotPath string

	m := http.NewServeMux()
	m.HandleFunc("/users/1", func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		w.Write([]byte("user1"))
	})

	h := CleanPath(m)

	req, _ := http.NewRequest("GET", "/users////1", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if w.Result().StatusCode != http.StatusOK {
		t.Errorf("clean path (nil ctx): unexpected response code: %v", w.Result().StatusCode)
	}
	if gotPath != "/users/1" {
		t.Errorf("clean path (nil ctx): got %q, want %q", gotPath, "/users/1")
	}
}
