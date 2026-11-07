package middleware

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/go-chi/chi/v5"
)

// StripSlashes is a middleware that will match request paths with a trailing
// slash, strip it from the path and continue routing through the mux, if a route
// matches, then it will serve the handler.
func StripSlashes(next http.Handler) http.Handler {
	fn := func(w http.ResponseWriter, r *http.Request) {
		var path string
		rctx := chi.RouteContext(r.Context())
		if rctx != nil && rctx.RoutePath != "" {
			path = rctx.RoutePath
		} else {
			path = r.URL.Path
		}
		if len(path) > 1 && path[len(path)-1] == '/' {
			newPath := path[:len(path)-1]
			if rctx == nil {
				r.URL.Path = newPath
			} else {
				rctx.RoutePath = newPath
			}
		}
		next.ServeHTTP(w, r)
	}
	return http.HandlerFunc(fn)
}

// RedirectSlashes is a middleware that will match request paths with a trailing
// slash and redirect to the same path, less the trailing slash.
//
// NOTE: RedirectSlashes middleware is *incompatible* with http.FileServer,
// see https://github.com/go-chi/chi/issues/343
func RedirectSlashes(next http.Handler) http.Handler {
	fn := func(w http.ResponseWriter, r *http.Request) {
		var path string
		rctx := chi.RouteContext(r.Context())
		if rctx != nil && rctx.RoutePath != "" {
			path = rctx.RoutePath
		} else {
			path = r.URL.Path
		}

		if len(path) > 1 && path[len(path)-1] == '/' {
			// Reject paths containing C0 control characters or DEL to prevent
			// open redirect bypasses (e.g., "/%09/evil.com/").
			if strings.IndexFunc(path, func(r rune) bool {
				return r < 0x20 || r == 0x7f
			}) != -1 {
				http.Error(w, "Bad Request", http.StatusBadRequest)
				return
			}

			// Normalize backslashes to forward slashes to prevent "/\evil.com" style redirects
			// that some clients may interpret as protocol-relative.
			path = strings.ReplaceAll(path, `\`, `/`)

			// Collapse leading/trailing slashes and force a single leading slash.
			path = "/" + strings.Trim(path, "/")

			// Emit a guaranteed same-origin reference via a parsed URL.
			u := &url.URL{Path: path, RawQuery: r.URL.RawQuery}
			http.Redirect(w, r, u.String(), 301)
			return
		}

		next.ServeHTTP(w, r)
	}
	return http.HandlerFunc(fn)
}

// StripPrefix is a middleware that will strip the provided prefix from the
// request path before handing the request over to the next handler.
func StripPrefix(prefix string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.StripPrefix(prefix, next)
	}
}
