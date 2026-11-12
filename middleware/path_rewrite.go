package middleware

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
)

// PathRewrite replaces the first occurrence of old with new in the request URL path.
// When the routing path has already been set, it is rewritten independently.
// In a mounted router, the routing path is relative to the mount point, so old
// and new should be relative to that point to affect routing. To rewrite a path
// including the mount prefix, install PathRewrite on the parent router instead.
func PathRewrite(old, new string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			r.URL.Path = strings.Replace(r.URL.Path, old, new, 1)
			if rctx := chi.RouteContext(r.Context()); rctx != nil && rctx.RoutePath != "" {
				rctx.RoutePath = strings.Replace(rctx.RoutePath, old, new, 1)
			}
			next.ServeHTTP(w, r)
		})
	}
}
