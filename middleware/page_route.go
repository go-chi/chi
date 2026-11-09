package middleware

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
)

// PageRoute is a simple middleware which allows you to route a static GET request
// at the middleware stack level.
func PageRoute(path string, handler http.Handler) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			routePath := r.URL.Path
			if rctx := chi.RouteContext(r.Context()); rctx != nil && rctx.RoutePath != "" {
				routePath = rctx.RoutePath
			}
			if r.Method == "GET" && strings.EqualFold(routePath, path) {
				handler.ServeHTTP(w, r)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
