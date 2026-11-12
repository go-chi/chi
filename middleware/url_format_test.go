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

func TestURLFormatEncodedSlashInID(t *testing.T) {
	r := chi.NewRouter()

	r.Use(URLFormat)

	r.Get("/items/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		format, _ := r.Context().Value(URLFormatCtxKey).(string)
		if format != "" {
			w.Write([]byte(id + " " + format))
			return
		}
		w.Write([]byte(id))
	})

	ts := httptest.NewServer(r)
	defer ts.Close()

	if _, resp := testRequest(t, ts, "GET", "/items/a%2Fb", nil); resp != "a%2Fb" {
		t.Fatalf("encoded slash without suffix: %q", resp)
	}
	if _, resp := testRequest(t, ts, "GET", "/items/a%2Fb.json", nil); resp != "a%2Fb json" {
		t.Fatalf("encoded slash with json suffix: %q", resp)
	}
	// %20 can be unescaped without changing path segments, so the id is
	// the decoded value, matching a request that has no format suffix.
	if _, resp := testRequest(t, ts, "GET", "/items/foo%20bar.xml", nil); resp != "foo bar xml" {
		t.Fatalf("encoded space with xml suffix: %q", resp)
	}
}
