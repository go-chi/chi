package middleware

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

// Find the route pattern for the request path.
//
// This middleware does not need to be the last middleware to resolve the
// route pattern. The pattern is fully resolved before the request has been
// handled.
func FindPattern(routes chi.Routes, callback func(pattern string)) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		fn := func(w http.ResponseWriter, r *http.Request) {
			// Find mutates the context so always make a new one
			rctx := chi.NewRouteContext()
			path := r.URL.Path
			op := r.Method
			pattern := routes.Find(rctx, op, path)
			callback(pattern)

			next.ServeHTTP(w, r)
		}
		return http.HandlerFunc(fn)
	}

}
