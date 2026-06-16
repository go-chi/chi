package middleware

import (
	"net/http"
	"path"

	"github.com/go-chi/chi/v5"
)

// CleanPath middleware will clean out double slash mistakes from a user's request path.
// For example, if a user requests /users//1 or //users////1 will both be treated as: /users/1
func CleanPath(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rctx := chi.RouteContext(r.Context())

		routePath := rctx.RoutePath
		if routePath == "" {
			routePath = r.URL.EscapedPath()
			if routePath == "" {
				routePath = "/"
			}
			rctx.RoutePath = path.Clean(routePath)
		}

		next.ServeHTTP(w, r)
	})
}
