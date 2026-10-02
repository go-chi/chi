package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestGetHead(t *testing.T) {
	r := chi.NewRouter()
	r.Use(GetHead)
	r.Get("/hi", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Test", "yes")
		w.Write([]byte("bye"))
	})
	r.Route("/articles", func(r chi.Router) {
		r.Get("/{id}", func(w http.ResponseWriter, r *http.Request) {
			id := chi.URLParam(r, "id")
			w.Header().Set("X-Article", id)
			w.Write([]byte("article:" + id))
		})
	})
	r.Route("/users", func(r chi.Router) {
		r.Head("/{id}", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("X-User", "-")
			w.Write([]byte("user"))
		})
		r.Get("/{id}", func(w http.ResponseWriter, r *http.Request) {
			id := chi.URLParam(r, "id")
			w.Header().Set("X-User", id)
			w.Write([]byte("user:" + id))
		})
	})

	ts := httptest.NewServer(r)
	defer ts.Close()

	if _, body := testRequest(t, ts, "GET", "/hi", nil); body != "bye" {
		t.Fatal(body)
	}
	if req, body := testRequest(t, ts, "HEAD", "/hi", nil); body != "" || req.Header.Get("X-Test") != "yes" {
		t.Fatal(body)
	}
	if _, body := testRequest(t, ts, "GET", "/", nil); body != "404 page not found\n" {
		t.Fatal(body)
	}
	if req, body := testRequest(t, ts, "HEAD", "/", nil); body != "" || req.StatusCode != 404 {
		t.Fatal(body)
	}

	if _, body := testRequest(t, ts, "GET", "/articles/5", nil); body != "article:5" {
		t.Fatal(body)
	}
	if req, body := testRequest(t, ts, "HEAD", "/articles/5", nil); body != "" || req.Header.Get("X-Article") != "5" {
		t.Fatalf("expecting X-Article header '5' but got '%s'", req.Header.Get("X-Article"))
	}

	if _, body := testRequest(t, ts, "GET", "/users/1", nil); body != "user:1" {
		t.Fatal(body)
	}
	if req, body := testRequest(t, ts, "HEAD", "/users/1", nil); body != "" || req.Header.Get("X-User") != "-" {
		t.Fatalf("expecting X-User header '-' but got '%s'", req.Header.Get("X-User"))
	}
}

func TestGetHeadAllowHeader(t *testing.T) {
	r := chi.NewRouter()
	r.Use(GetHead)
	r.Get("/hi", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("hi"))
	})
	r.Post("/only-post", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("posted"))
	})

	ts := httptest.NewServer(r)
	defer ts.Close()

	resp, _ := testRequest(t, ts, "POST", "/hi", nil)
	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("status=%d want 405", resp.StatusCode)
	}
	if !allowHasMethod(resp.Header, http.MethodGet) || !allowHasMethod(resp.Header, http.MethodHead) {
		t.Fatalf("Allow=%v want GET and HEAD", resp.Header.Values("Allow"))
	}

	resp, _ = testRequest(t, ts, "PUT", "/only-post", nil)
	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("status=%d want 405", resp.StatusCode)
	}
	if !allowHasMethod(resp.Header, http.MethodPost) {
		t.Fatalf("Allow=%v want POST", resp.Header.Values("Allow"))
	}
	if allowHasMethod(resp.Header, http.MethodHead) {
		t.Fatalf("Allow=%v should not include HEAD without GET", resp.Header.Values("Allow"))
	}
}
