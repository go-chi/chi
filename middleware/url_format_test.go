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

func TestURLFormatURLParamDecoded(t *testing.T) {
	r := chi.NewRouter()
	r.Use(URLFormat)
	r.Get("/articles/{id}", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(chi.URLParam(r, "id")))
	})

	ts := httptest.NewServer(r)
	defer ts.Close()

	// URLFormat derives the routing path from the decoded URL path,
	// so the parameter must not be decoded again (#832).
	if _, resp := testRequest(t, ts, "GET", "/articles/It's%20great.json", nil); resp != "It's great" {
		t.Errorf("URLFormat + encoded param: got %q, want %q", resp, "It's great")
	}
	if _, resp := testRequest(t, ts, "GET", "/articles/my%2520data.json", nil); resp != "my%20data" {
		t.Errorf("URLFormat + doubly-encoded param: got %q, want %q", resp, "my%20data")
	}
}
