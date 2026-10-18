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

func TestPathRewritePlainHandler(t *testing.T) {
	handler := middleware.PathRewrite("/old", "/new")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, r.URL.Path)
	}))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/old/item", nil))
	if rec.Code != http.StatusOK || rec.Body.String() != "/new/item" {
		t.Fatalf("got %d %q", rec.Code, rec.Body.String())
	}
}

func TestPathRewriteMountedRouter(t *testing.T) {
	for _, tc := range []struct {
		name   string
		prefix string
		target string
		want   string
	}{
		{"root", "", "/old/item?sort=asc", "/new/item|item|sort=asc"},
		{"mount", "/api", "/api/old/item?sort=asc", "/api/new/item|item|sort=asc"},
		{"nested mount", "/api/v1", "/api/v1/old/item?sort=asc", "/api/v1/new/item|item|sort=asc"},
		{"no replacement", "/api", "/api/new/item?sort=asc", "/api/new/item|item|sort=asc"},
		{"encoded parameter", "/api", "/api/old/a%2Fb?sort=asc", "/api/new/a/b|a%2Fb|sort=asc"},
		{"replace once", "/api", "/api/old/old?sort=asc", "/api/new/old|old|sort=asc"},
		{"mount prefix also matches", "/old", "/old/old/item?sort=asc", "/new/old/item|item|sort=asc"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			sub := chi.NewRouter()
			sub.Use(middleware.PathRewrite("/old", "/new"))
			sub.Get("/new/{id}", func(w http.ResponseWriter, r *http.Request) {
				fmt.Fprintf(w, "%s|%s|%s", r.URL.Path, chi.URLParam(r, "id"), r.URL.RawQuery)
				if tc.prefix == "/old" && chi.RouteContext(r.Context()).RoutePath != "/new/item" {
					t.Errorf("routing path = %q, want /new/item", chi.RouteContext(r.Context()).RoutePath)
				}
			})
			var handler http.Handler = sub
			if tc.prefix != "" {
				root := chi.NewRouter()
				if tc.prefix == "/api/v1" {
					root.Route("/api", func(r chi.Router) { r.Mount("/v1", sub) })
				} else {
					root.Mount(tc.prefix, sub)
				}
				handler = root
			}
			server := httptest.NewServer(handler)
			defer server.Close()
			resp, err := server.Client().Get(server.URL + tc.target)
			if err != nil {
				t.Fatal(err)
			}
			defer resp.Body.Close()
			body, err := io.ReadAll(resp.Body)
			if err != nil {
				t.Fatal(err)
			}
			if resp.StatusCode != http.StatusOK || string(body) != tc.want {
				t.Fatalf("got %d %q, want 200 %q", resp.StatusCode, body, tc.want)
			}
		})
	}
}
