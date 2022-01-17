package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	chi "github.com/go-chi/chi/v5"
)

func TestHeartbeat(t *testing.T) {
	r := chi.NewRouter()
	r.Use(Heartbeat("/ping"))
	r.Get("/ping", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/ping", nil)
	r.ServeHTTP(w, req)

	if w.Result().StatusCode != http.StatusOK {
		t.Errorf("heartbeat: unexpected response code: %v", w.Result().StatusCode)
	}
}
