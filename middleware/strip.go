package middleware

import (
	"net/http"

	"github.com/pressly/chi"
	"golang.org/x/net/context"
)

// StripSlashes is a middleware that will match request paths with a trailing
// slash, strip it from the path and continue routing through the mux, if a route
// matches, then it will serve the handler.
func StripSlashes(next chi.Handler) chi.Handler {
	fn := func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if len(path) > 1 && path[len(path)-1] == '/' {
			rctx := chi.RouteContext(ctx)
			rctx.RoutePath = path[:len(path)-1]
		}
		next.ServeHTTPC(ctx, w, r)
	}
	return chi.HandlerFunc(fn)
}

// RedirectSlashes is a middleware that will match request paths with a trailing
// slash and redirect to the same path, less the trailing slash.
func RedirectSlashes(next chi.Handler) chi.Handler {
	fn := func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if len(path) > 1 && path[len(path)-1] == '/' {
			path = path[:len(path)-1]
			http.Redirect(w, r, path, 301)
			return
		}
		next.ServeHTTPC(ctx, w, r)
	}
	return chi.HandlerFunc(fn)
}
