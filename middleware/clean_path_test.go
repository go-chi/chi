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

func TestCleanPathURLParamDecoded(t *testing.T) {
	r := chi.NewRouter()
	r.Use(CleanPath)
	r.Get("/{key}", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(chi.URLParam(r, "key")))
	})

	ts := httptest.NewServer(r)
	defer ts.Close()

	// RawPath is set: the parameter must be decoded exactly once (#832).
	if _, body := testRequest(t, ts, "GET", "/It's%20great", nil); body != "It's great" {
		t.Errorf("CleanPath + encoded param: got %q, want %q", body, "It's great")
	}
	// RawPath is empty and the value is doubly-encoded: it must not
	// be decoded twice.
	if _, body := testRequest(t, ts, "GET", "/my%2520data", nil); body != "my%20data" {
		t.Errorf("CleanPath + doubly-encoded param: got %q, want %q", body, "my%20data")
	}
}
