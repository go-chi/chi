package middleware

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

// GetHead automatically route undefined HEAD requests to GET handlers.
func GetHead(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "HEAD" {
			rctx := chi.RouteContext(r.Context())
			routePath := rctx.RoutePath
			if routePath == "" {
				if r.URL.RawPath != "" {
					routePath = r.URL.RawPath
				} else {
					routePath = r.URL.Path
				}
			}

			// rctx.Routes is always the root router. Inside a mounted
			// sub-router, a parent route has already matched and RoutePath
			// is relative to the sub-router, so probe the root with the
			// full request path instead.
			probePath := routePath
			if len(rctx.RoutePatterns) > 0 {
				if r.URL.RawPath != "" {
					probePath = r.URL.RawPath
				} else {
					probePath = r.URL.Path
				}
			}

			// Temporary routing context to look-ahead before routing the request
			tctx := chi.NewRouteContext()

			// Attempt to find a HEAD handler for the routing path, if not found, traverse
			// the router as through its a GET route, but proceed with the request
			// with the HEAD method.
			if !rctx.Routes.Match(tctx, "HEAD", probePath) {
				rctx.RouteMethod = "GET"
				rctx.RoutePath = routePath
				next.ServeHTTP(w, r)
				return
			}
		}

		next.ServeHTTP(w, r)
	})
}
