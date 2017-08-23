package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi"
)

func TestHeadGet(t *testing.T) {
	r := chi.NewRouter()
	r.Use(HeadGet)
	r.Get("/hi", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Test", "yes")
		w.Write([]byte("bye"))
	})

	ts := httptest.NewServer(r)
	defer ts.Close()

	if _, body := testRequest(t, ts, "GET", "/hi", nil); body != "bye" {
		t.Fatalf(body)
	}
	if req, body := testRequest(t, ts, "HEAD", "/hi", nil); body != "" || req.Header.Get("X-Test") != "yes" {
		t.Fatalf(body)
	}
	if _, body := testRequest(t, ts, "GET", "/", nil); body != "404 page not found\n" {
		t.Fatalf(body)
	}
	if req, body := testRequest(t, ts, "HEAD", "/", nil); body != "" || req.StatusCode != 404 {
		t.Fatalf(body)
	}
}
