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

func TestGetHeadInSubrouter(t *testing.T) {
	tag := func(name string) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("X-Handler", name)
		}
	}

	tests := []struct {
		name       string
		setup      func(r chi.Router)
		path       string
		wantStatus int
		wantTag    string
	}{
		{
			name: "explicit HEAD handler in subrouter",
			setup: func(r chi.Router) {
				r.Route("/api", func(r chi.Router) {
					r.Use(GetHead)
					r.Get("/info", tag("get"))
					r.Head("/info", tag("head"))
				})
			},
			path:       "/api/info",
			wantStatus: http.StatusOK,
			wantTag:    "head",
		},
		{
			name: "GET-only route in subrouter",
			setup: func(r chi.Router) {
				r.Route("/api", func(r chi.Router) {
					r.Use(GetHead)
					r.Get("/info", tag("get"))
				})
			},
			path:       "/api/info",
			wantStatus: http.StatusOK,
			wantTag:    "get",
		},
		{
			name: "root catch-all for every method",
			setup: func(r chi.Router) {
				r.Handle("/*", tag("static"))
				r.Route("/api", func(r chi.Router) {
					r.Use(GetHead)
					r.Get("/users", tag("get"))
				})
			},
			path:       "/api/users",
			wantStatus: http.StatusOK,
			wantTag:    "get",
		},
		{
			name: "nested subrouters",
			setup: func(r chi.Router) {
				r.Handle("/*", tag("static"))
				r.Route("/api", func(r chi.Router) {
					r.Route("/v1", func(r chi.Router) {
						r.Use(GetHead)
						r.Get("/users/{id}", tag("get"))
					})
				})
			},
			path:       "/api/v1/users/1",
			wantStatus: http.StatusOK,
			wantTag:    "get",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := chi.NewRouter()
			tt.setup(r)

			w := httptest.NewRecorder()
			r.ServeHTTP(w, httptest.NewRequest(http.MethodHead, tt.path, nil))

			if w.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", w.Code, tt.wantStatus)
			}
			if got := w.Header().Get("X-Handler"); got != tt.wantTag {
				t.Errorf("X-Handler = %q, want %q", got, tt.wantTag)
			}
		})
	}
}
