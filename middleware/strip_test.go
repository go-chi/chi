package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v3"
)

func TestStripSlashes(t *testing.T) {
	r := chi.NewRouter()

	// This middleware must be mounted at the top level of the router, not at the end-handler
	// because then it'll be too late and will end up in a 404
	r.Use(StripSlashes)

	r.NotFound(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(404)
		w.Write([]byte("nothing here"))
	})

	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("root"))
	})

	r.Route("/accounts/{accountID}", func(r chi.Router) {
		r.Get("/", func(w http.ResponseWriter, r *http.Request) {
			accountID := chi.URLParam(r, "accountID")
			w.Write([]byte(accountID))
		})
	})

	ts := httptest.NewServer(r)
	defer ts.Close()

	if _, resp := testRequest(t, ts, "GET", "/", nil); resp != "root" {
		t.Fatalf(resp)
	}
	if _, resp := testRequest(t, ts, "GET", "//", nil); resp != "root" {
		t.Fatalf(resp)
	}
	if _, resp := testRequest(t, ts, "GET", "/accounts/admin", nil); resp != "admin" {
		t.Fatalf(resp)
	}
	if _, resp := testRequest(t, ts, "GET", "/accounts/admin/", nil); resp != "admin" {
		t.Fatalf(resp)
	}
	if _, resp := testRequest(t, ts, "GET", "/nothing-here", nil); resp != "nothing here" {
		t.Fatalf(resp)
	}
}

func TestStripSlashesInRoute(t *testing.T) {
	r := chi.NewRouter()

	r.NotFound(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(404)
		w.Write([]byte("nothing here"))
	})

	r.Get("/hi", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("hi"))
	})

	r.Route("/accounts/{accountID}", func(r chi.Router) {
		r.Use(StripSlashes)
		r.Get("/", func(w http.ResponseWriter, r *http.Request) {
			w.Write([]byte("accounts index"))
		})
		r.Get("/query", func(w http.ResponseWriter, r *http.Request) {
			accountID := chi.URLParam(r, "accountID")
			w.Write([]byte(accountID))
		})
	})

	ts := httptest.NewServer(r)
	defer ts.Close()

	if _, resp := testRequest(t, ts, "GET", "/hi", nil); resp != "hi" {
		t.Fatalf(resp)
	}
	if _, resp := testRequest(t, ts, "GET", "/hi/", nil); resp != "nothing here" {
		t.Fatalf(resp)
	}
	if _, resp := testRequest(t, ts, "GET", "/accounts/admin", nil); resp != "accounts index" {
		t.Fatalf(resp)
	}
	if _, resp := testRequest(t, ts, "GET", "/accounts/admin/", nil); resp != "accounts index" {
		t.Fatalf(resp)
	}
	if _, resp := testRequest(t, ts, "GET", "/accounts/admin/query", nil); resp != "admin" {
		t.Fatalf(resp)
	}
	if _, resp := testRequest(t, ts, "GET", "/accounts/admin/query/", nil); resp != "admin" {
		t.Fatalf(resp)
	}
}

func TestRedirectSlashes(t *testing.T) {
	r := chi.NewRouter()

	// This middleware must be mounted at the top level of the router, not at the end-handler
	// because then it'll be too late and will end up in a 404
	r.Use(RedirectSlashes)

	r.NotFound(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(404)
		w.Write([]byte("nothing here"))
	})

	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("root"))
	})

	r.Route("/accounts/{accountID}", func(r chi.Router) {
		r.Get("/", func(w http.ResponseWriter, r *http.Request) {
			accountID := chi.URLParam(r, "accountID")
			w.Write([]byte(accountID))
		})
	})

	ts := httptest.NewServer(r)
	defer ts.Close()

	if req, resp := testRequest(t, ts, "GET", "/", nil); resp != "root" && req.StatusCode != 200 {
		t.Fatalf(resp)
	}

	// NOTE: the testRequest client will follow the redirection..
	if req, resp := testRequest(t, ts, "GET", "//", nil); resp != "root" && req.StatusCode != 200 {
		t.Fatalf(resp)
	}

	if req, resp := testRequest(t, ts, "GET", "/accounts/admin", nil); resp != "admin" && req.StatusCode != 200 {
		t.Fatalf(resp)
	}

	// NOTE: the testRequest client will follow the redirection..
	if req, resp := testRequest(t, ts, "GET", "/accounts/admin/", nil); resp != "admin" && req.StatusCode != 200 {
		t.Fatalf(resp)
	}

	if req, resp := testRequest(t, ts, "GET", "/nothing-here", nil); resp != "nothing here" && req.StatusCode != 200 {
		t.Fatalf(resp)
	}
}
