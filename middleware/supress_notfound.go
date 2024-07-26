package middleware

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

// SupressNotFound will quickly respond with a 404 if the route is not found
// and will not continue to the next middleware handler.
//
// This is handy to put at the top of your middleware stack to avoid unnecessary
// processing of requests that are not going to match any routes anyway. For
// example its super annoying to see a bunch of 404's in your logs from bots.
func SupressNotFound(router *chi.Mux) func(next http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			rctx := chi.RouteContext(r.Context())

			// Match() updates rctx.RoutePath.
			// Save the initial value to restore it later on for the next in chain.
			initialRoutePath := rctx.RoutePath

			match := rctx.Routes.Match(rctx, r.Method, r.URL.Path)
			if !match {
				router.NotFoundHandler().ServeHTTP(w, r)
				return
			}

			// Restore after modification.
			rctx.RoutePath = initialRoutePath

			next.ServeHTTP(w, r)
		})
	}
}
