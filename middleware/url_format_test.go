package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestURLFormat(t *testing.T) {
	r := chi.NewRouter()

	r.Use(URLFormat)

	r.NotFound(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(404)
		w.Write([]byte("nothing here"))
	})

	r.Route("/samples/articles/samples.{articleID}", func(r chi.Router) {
		r.Get("/", func(w http.ResponseWriter, r *http.Request) {
			articleID := chi.URLParam(r, "articleID")
			w.Write([]byte(articleID))
		})
	})

	r.Route("/articles/{articleID}", func(r chi.Router) {
		r.Get("/", func(w http.ResponseWriter, r *http.Request) {
			articleID := chi.URLParam(r, "articleID")
			w.Write([]byte(articleID))
		})
	})

	ts := httptest.NewServer(r)
	defer ts.Close()

	if _, resp := testRequest(t, ts, "GET", "/articles/1.json", nil); resp != "1" {
		t.Fatalf(resp)
	}
	if _, resp := testRequest(t, ts, "GET", "/articles/1.xml", nil); resp != "1" {
		t.Fatalf(resp)
	}
	if _, resp := testRequest(t, ts, "GET", "/samples/articles/samples.1.json", nil); resp != "1" {
		t.Fatalf(resp)
	}
	if _, resp := testRequest(t, ts, "GET", "/samples/articles/samples.1.xml", nil); resp != "1" {
		t.Fatalf(resp)
	}
}

func TestURLFormatInSubRouter(t *testing.T) {
	r := chi.NewRouter()

	r.Route("/articles/{articleID}", func(r chi.Router) {
		r.Use(URLFormat)
		r.Get("/subroute", func(w http.ResponseWriter, r *http.Request) {
			articleID := chi.URLParam(r, "articleID")
			w.Write([]byte(articleID))
		})
	})

	ts := httptest.NewServer(r)
	defer ts.Close()

	if _, resp := testRequest(t, ts, "GET", "/articles/1/subroute.json", nil); resp != "1" {
		t.Fatalf(resp)
	}
}

func TestURLFormatWithoutChiRouteContext(t *testing.T) {
	r := chi.NewRouter()

	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			newCtx := context.WithValue(r.Context(), chi.RouteCtxKey, nil)
			next.ServeHTTP(w, r.WithContext(newCtx))
		})
	})
	r.Use(URLFormat)
	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("OK"))
	})

	ts := httptest.NewServer(r)
	defer ts.Close()

	resp, respBody := testRequest(t, ts, "GET", "/", nil)
	if resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("non 500 response: %v", resp.StatusCode)
	}

	if strings.TrimSpace(respBody) != errRouteContextNil {
		t.Fatalf("Expected error message: %s, but got: %s", errRouteContextNil, respBody)
	}
}
