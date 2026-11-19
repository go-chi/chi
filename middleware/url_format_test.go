package middleware

import (
	"net/http"
	"net/http/httptest"
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
		t.Fatal(resp)
	}
	if _, resp := testRequest(t, ts, "GET", "/articles/1.xml", nil); resp != "1" {
		t.Fatal(resp)
	}
	if _, resp := testRequest(t, ts, "GET", "/samples/articles/samples.1.json", nil); resp != "1" {
		t.Fatal(resp)
	}
	if _, resp := testRequest(t, ts, "GET", "/samples/articles/samples.1.xml", nil); resp != "1" {
		t.Fatal(resp)
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
		t.Fatal(resp)
	}
}

func TestURLFormatEncodedSlash(t *testing.T) {
	r := chi.NewRouter()
	r.Use(URLFormat)

	r.NotFound(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(404)
		w.Write([]byte("nothing here"))
	})

	r.Get("/items/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		format := r.Context().Value(URLFormatCtxKey).(string)
		w.Write([]byte(id + ":" + format))
	})

	r.Route("/items/{id}/details", func(r chi.Router) {
		r.Get("/", func(w http.ResponseWriter, r *http.Request) {
			id := chi.URLParam(r, "id")
			format := r.Context().Value(URLFormatCtxKey).(string)
			w.Write([]byte(id + ":details:" + format))
		})
	})

	ts := httptest.NewServer(r)
	defer ts.Close()

	if _, resp := testRequest(t, ts, "GET", "/items/a%2Fb.json", nil); resp != "a%2Fb:json" {
		t.Fatalf("expected 'a%%2Fb:json', got %q", resp)
	}
	if _, resp := testRequest(t, ts, "GET", "/items/a%2Fb.xml", nil); resp != "a%2Fb:xml" {
		t.Fatalf("expected 'a%%2Fb:xml', got %q", resp)
	}
	if _, resp := testRequest(t, ts, "GET", "/items/a%2Fb", nil); resp != "a%2Fb:" {
		t.Fatalf("expected 'a%%2Fb:', got %q", resp)
	}
	if _, resp := testRequest(t, ts, "GET", "/items/file.v1%2Ftest.json", nil); resp != "file.v1%2Ftest:json" {
		t.Fatalf("expected 'file.v1%%2Ftest:json', got %q", resp)
	}
	if _, resp := testRequest(t, ts, "GET", "/items/a%2Fb/details.json", nil); resp != "a%2Fb:details:json" {
		t.Fatalf("expected 'a%%2Fb:details:json', got %q", resp)
	}
}
