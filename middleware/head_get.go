package middleware

import (
	"net/http"

	"github.com/go-chi/chi"
)

func HeadGet(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "HEAD" {
			rctx := chi.RouteContext(r.Context())
			h := rctx.Routes.Find(chi.NewRouteContext(), "HEAD", rctx.RoutePath)
			if h == nil {
				rctx.RouteMethod = "GET"
				next.ServeHTTP(w, r)
				return
			}
		}

		next.ServeHTTP(w, r)
	})
}
