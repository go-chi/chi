package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestPageRoute(t *testing.T) {
	page := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
		w.Write([]byte(r.URL.Path))
	})
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusAccepted)
		w.Write([]byte(r.URL.Path))
	})

	for _, mount := range []string{"", "/api", "/api/v1"} {
		t.Run("mount="+mount, func(t *testing.T) {
			router := chi.NewRouter()
			sub := router
			if mount != "" {
				sub = chi.NewRouter()
				if mount == "/api/v1" {
					parent := chi.NewRouter()
					parent.Mount("/v1", sub)
					router.Mount("/api", parent)
				} else {
					router.Mount(mount, sub)
				}
			}
			sub.Use(PageRoute("/page", page))
			sub.Handle("/*", next)

			for _, tt := range []struct {
				method string
				path   string
				status int
			}{
				{http.MethodGet, "/page", http.StatusCreated},
				{http.MethodGet, "/PaGe", http.StatusCreated},
				{http.MethodPost, "/page", http.StatusAccepted},
				{http.MethodHead, "/page", http.StatusAccepted},
				{http.MethodGet, "/other", http.StatusAccepted},
			} {
				t.Run(tt.method+tt.path, func(t *testing.T) {
					path := mount + tt.path
					w := httptest.NewRecorder()
					router.ServeHTTP(w, httptest.NewRequest(tt.method, path, nil))
					if w.Code != tt.status {
						t.Errorf("status = %d, want %d", w.Code, tt.status)
					}
					if w.Body.String() != path {
						t.Errorf("request path = %q, want %q", w.Body.String(), path)
					}
				})
			}
		})
	}
}

func TestPageRouteWithoutRouter(t *testing.T) {
	page := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
	})
	handler := PageRoute("/page", page)(http.NotFoundHandler())
	for _, tt := range []struct {
		method string
		path   string
		status int
	}{
		{http.MethodGet, "/page", http.StatusCreated},
		{http.MethodGet, "/PaGe", http.StatusCreated},
		{http.MethodPost, "/page", http.StatusNotFound},
		{http.MethodGet, "/other", http.StatusNotFound},
	} {
		t.Run(tt.method+tt.path, func(t *testing.T) {
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, httptest.NewRequest(tt.method, tt.path, nil))
			if w.Code != tt.status {
				t.Errorf("status = %d, want %d", w.Code, tt.status)
			}
		})
	}
}
