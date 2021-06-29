package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestRecoverer(t *testing.T) {
	r := chi.NewRouter()

	r.Use(Recoverer)
	r.Get("/", func(http.ResponseWriter, *http.Request) { panic("foo") })

	ts := httptest.NewServer(r)
	defer ts.Close()

	res, _ := testRequest(t, ts, "GET", "/", nil)
	assertEqual(t, res.StatusCode, http.StatusInternalServerError)
}
