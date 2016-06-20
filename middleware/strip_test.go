package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/pressly/chi"
	"golang.org/x/net/context"
)

func TestStripSlashes(t *testing.T) {
	r := chi.NewRouter()

	// This middleware must be mounted at the top level of the router, not at the end-handler
	// because then it'll be too late and will end up in a 404
	r.Use(StripSlashes)

	r.NotFound(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(404)
		w.Write([]byte("nothing here"))
	})

	r.Get("/", func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("root"))
	})

	r.Route("/accounts/:accountID", func(r chi.Router) {
		r.Get("/", func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
			accountID := chi.URLParam(ctx, "accountID")
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

func TestRedirectSlashes(t *testing.T) {
	r := chi.NewRouter()

	// This middleware must be mounted at the top level of the router, not at the end-handler
	// because then it'll be too late and will end up in a 404
	r.Use(RedirectSlashes)

	r.NotFound(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(404)
		w.Write([]byte("nothing here"))
	})

	r.Get("/", func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("root"))
	})

	r.Route("/accounts/:accountID", func(r chi.Router) {
		r.Get("/", func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
			accountID := chi.URLParam(ctx, "accountID")
			w.Write([]byte(accountID))
		})
	})

	ts := httptest.NewServer(r)
	defer ts.Close()

	if status, resp := testRequest(t, ts, "GET", "/", nil); resp != "root" && status != 200 {
		t.Fatalf(resp)
	}

	// NOTE: the testRequest client will follow the redirection..
	if status, resp := testRequest(t, ts, "GET", "//", nil); resp != "root" && status != 200 {
		t.Fatalf(resp)
	}

	if status, resp := testRequest(t, ts, "GET", "/accounts/admin", nil); resp != "admin" && status != 200 {
		t.Fatalf(resp)
	}

	// NOTE: the testRequest client will follow the redirection..
	if status, resp := testRequest(t, ts, "GET", "/accounts/admin/", nil); resp != "admin" && status != 200 {
		t.Fatalf(resp)
	}

	if status, resp := testRequest(t, ts, "GET", "/nothing-here", nil); resp != "nothing here" && status != 200 {
		t.Fatalf(resp)
	}
}
