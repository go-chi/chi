package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	chi "github.com/go-chi/chi/v5"
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
