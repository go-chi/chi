package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
)

func TestNoCache(t *testing.T) {
	r := chi.NewRouter()
	r.Use(NoCache)

	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("ETag", "33a64df551425fcc55e4d42a148795d9f25f89d4")
		w.Write([]byte("beepboopimatest"))
		w.WriteHeader(http.StatusOK)
	})

	s := httptest.NewServer(r)
	defer s.Close()

	c := http.Client{
		Timeout: 5 * time.Second,
	}

	res, err := c.Get(s.URL)

	assertNoError(t, err)
	assertEqual(t, res.Header.Get("Expires"), time.Unix(0, 0).UTC().Format(http.TimeFormat))
	assertEqual(t, res.Header.Get("Cache-Control"), "no-cache, no-store, no-transform, must-revalidate, private, max-age=0")
	assertEqual(t, res.Header.Get("X-Accel-Expires"), "0")
	assertEqual(t, res.Header.Get("Pragma"), "no-cache")

	assertEqual(t, res.Header.Get("ETag"), "33a64df551425fcc55e4d42a148795d9f25f89d4")
}
