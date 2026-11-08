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
//
// Note that a route which exists but has no handler for the request method is
// also reported as not found, so such requests get a 404 from here rather than
// a 405 from the router.
func SupressNotFound(router *chi.Mux) func(next http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			rctx := chi.RouteContext(r.Context())

			// Resolve the method and path the same way the router resolves them
			// when it dispatches. Otherwise the preflight can reject a request
			// the router would have served: dispatch prefers RawPath over the
			// decoded URL.Path, and middleware earlier in the chain may have
			// overridden RouteMethod (GetHead does this for HEAD requests).
			method := rctx.RouteMethod
			if method == "" {
				method = r.Method
			}
			path := r.URL.Path
			if r.URL.RawPath != "" {
				path = r.URL.RawPath
			}
			if path == "" {
				path = "/"
			}

			// Match records state on the context it is given, so probe with a
			// throwaway context, as GetHead does.
			match := rctx.Routes.Match(chi.NewRouteContext(), method, path)
			if !match {
				router.NotFoundHandler().ServeHTTP(w, r)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
