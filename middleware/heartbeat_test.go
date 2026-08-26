package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	chi "github.com/go-chi/chi/v5"
)

func TestHeartbeat(t *testing.T) {
	endpoint := "/ping"

	r := chi.NewRouter()
	r.Use(Heartbeat(endpoint))
	r.Handle(endpoint, http.NotFoundHandler())

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, endpoint, http.NoBody)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("heartbeat: unexpected response code: %v", w.Code)
	}
	if w.Body.String() != "." {
		t.Errorf("heartbeat: unexpected response body: %q", w.Body.String())
	}
	if got := w.Header().Get("Content-Type"); got != "text/plain" {
		t.Errorf("heartbeat: unexpected Content-Type: %q", got)
	}
}
