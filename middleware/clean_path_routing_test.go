package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestCleanPathMountedRouter(t *testing.T) {
	for _, mount := range []string{"", "/api", "/api/v1"} {
		for _, suffix := range []string{"/users//1", "/users/./1", "/users/other/../1", "/users/1"} {
			t.Run(mount+suffix, func(t *testing.T) {
				root := chi.NewRouter()
				router := root
				if mount != "" {
					for _, segment := range strings.Split(strings.TrimPrefix(mount, "/"), "/") {
						child := chi.NewRouter()
						router.Mount("/"+segment, child)
						router = child
					}
				}
				router.Use(CleanPath)
				router.Get("/users/{id}", func(w http.ResponseWriter, r *http.Request) {
					if id := chi.URLParam(r, "id"); id != "1" {
						t.Errorf("id = %q, want 1", id)
					}
					w.WriteHeader(http.StatusNoContent)
				})
				request := httptest.NewRequest(http.MethodGet, mount+suffix, nil)
				response := httptest.NewRecorder()
				root.ServeHTTP(response, request)
				if response.Code != http.StatusNoContent {
					t.Errorf("status = %d, want %d", response.Code, http.StatusNoContent)
				}
			})
		}
	}
}

func TestCleanPathExistingRoutePath(t *testing.T) {
	for _, routePath := range []string{"/users//a%2Fb", "/users/./a%2Fb", "/users/a%2Fb", "/"} {
		t.Run(routePath, func(t *testing.T) {
			rctx := chi.NewRouteContext()
			rctx.RoutePath = routePath
			request := httptest.NewRequest(http.MethodGet, "/original", nil)
			request = request.WithContext(context.WithValue(request.Context(), chi.RouteCtxKey, rctx))
			handler := CleanPath(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				want := "/users/a%2Fb"
				if routePath == "/" {
					want = "/"
				}
				if got := chi.RouteContext(r.Context()).RoutePath; got != want {
					t.Errorf("RoutePath = %q, want %q", got, want)
				}
				if r.URL.Path != "/original" {
					t.Errorf("URL.Path = %q, want /original", r.URL.Path)
				}
			}))
			handler.ServeHTTP(httptest.NewRecorder(), request)
		})
	}
}

func TestCleanPathAfterStripSlashes(t *testing.T) {
	router := chi.NewRouter()
	router.Use(StripSlashes, CleanPath)
	router.Get("/users/1", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/users//1/", nil))
	if response.Code != http.StatusNoContent {
		t.Errorf("status = %d, want %d", response.Code, http.StatusNoContent)
	}
}
