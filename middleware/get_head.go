package middleware

import (
	"net/http"

	"github.com/go-chi/chi"
)

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

			// Temporary routing context to look-ahead before routing the request
			tctx := chi.NewRouteContext()
			tctx.RouteMethod = "HEAD"
			tctx.RoutePath = routePath

			if !rctx.Routes.Match(tctx, tctx.RouteMethod, tctx.RoutePath) {
				rctx.RouteMethod = "GET"
				next.ServeHTTP(w, r)
				return
			}
		}

		next.ServeHTTP(w, r)
	})
}
