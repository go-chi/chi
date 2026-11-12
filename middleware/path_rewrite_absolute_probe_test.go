package middleware_test

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

// Full-path rewrites belong before the router that consumes the mount prefix.
func TestPathRewriteAbsoluteMountPlacement(t *testing.T) {
	for _, placement := range []string{"parent", "mounted"} {
		t.Run(placement, func(t *testing.T) {
			root, sub := chi.NewRouter(), chi.NewRouter()
			rewrite := middleware.PathRewrite("/api/old", "/api/new")
			if placement == "parent" {
				root.Use(rewrite)
			} else {
				sub.Use(rewrite)
			}
			sub.Get("/new/{id}", func(w http.ResponseWriter, r *http.Request) {
				fmt.Fprintf(w, "%s|%s", r.URL.Path, chi.URLParam(r, "id"))
			})
			sub.NotFound(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusNotFound)
				fmt.Fprintf(w, "%s|%s", r.URL.Path, chi.RouteContext(r.Context()).RoutePath)
			})
			root.Mount("/api", sub)
			server := httptest.NewServer(root)
			defer server.Close()
			resp, err := server.Client().Get(server.URL + "/api/old/item")
			if err != nil {
				t.Fatal(err)
			}
			defer resp.Body.Close()
			body, err := io.ReadAll(resp.Body)
			if err != nil {
				t.Fatal(err)
			}
			wantCode, wantBody := http.StatusOK, "/api/new/item|item"
			if placement == "mounted" {
				wantCode, wantBody = http.StatusNotFound, "/api/new/item|/old/item"
			}
			if resp.StatusCode != wantCode || string(body) != wantBody {
				t.Fatalf("got %d %q, want %d %q", resp.StatusCode, body, wantCode, wantBody)
			}
		})
	}
}

// URLFormat changes only the routing path. Do not restore its removed suffix
// by reconstructing RoutePath from URL.Path.
func TestPathRewriteAfterURLFormat(t *testing.T) {
	for _, prefix := range []string{"", "/api"} {
		t.Run(prefix, func(t *testing.T) {
			sub := chi.NewRouter()
			sub.Use(middleware.URLFormat)
			sub.Use(middleware.PathRewrite("/old", "/new"))
			sub.Get("/new/{id}", func(w http.ResponseWriter, r *http.Request) {
				fmt.Fprintf(w, "%s|%s|%s|%s", r.URL.Path, chi.URLParam(r, "id"), chi.RouteContext(r.Context()).RoutePath, r.Context().Value(middleware.URLFormatCtxKey))
			})
			var handler http.Handler = sub
			if prefix != "" {
				root := chi.NewRouter()
				root.Mount(prefix, sub)
				handler = root
			}
			server := httptest.NewServer(handler)
			defer server.Close()
			resp, err := server.Client().Get(server.URL + prefix + "/old/item.json")
			if err != nil {
				t.Fatal(err)
			}
			defer resp.Body.Close()
			body, err := io.ReadAll(resp.Body)
			if err != nil {
				t.Fatal(err)
			}
			want := prefix + "/new/item.json|item|/new/item|json"
			if resp.StatusCode != http.StatusOK || string(body) != want {
				t.Fatalf("got %d %q, want 200 %q", resp.StatusCode, body, want)
			}
		})
	}
}
