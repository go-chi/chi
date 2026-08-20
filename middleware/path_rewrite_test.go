package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	chi "github.com/go-chi/chi/v5"
)

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
