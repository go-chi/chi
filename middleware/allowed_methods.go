package middleware

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

// SetAllowHeader adds the Allow header to the response based on
// the methods that are registered for the requested path.
func SetAllowHeader(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rctx := chi.RouteContext(r.Context())
		url := r.URL.Path

		if rctx.Routes.Match(rctx, r.Method, url) {
			next.ServeHTTP(w, r)
			return
		}

		for _, method := range []string{"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "CONNECT", "TRACE"} {
			if rctx.Routes.Match(rctx, method, url) {
				w.Header().Add("Allow", method)
			}
		}
		next.ServeHTTP(w, r)
	})
}
