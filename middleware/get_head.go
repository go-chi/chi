package middleware

import (
	"net/http"
	"slices"
	"strings"

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

			// Temporary routing context to look-ahead before routing the request
			tctx := chi.NewRouteContext()

			// Attempt to find a HEAD handler for the routing path, if not found, traverse
			// the router as through its a GET route, but proceed with the request
			// with the HEAD method.
			if !rctx.Routes.Match(tctx, "HEAD", routePath) {
				rctx.RouteMethod = "GET"
				rctx.RoutePath = routePath
				next.ServeHTTP(w, r)
				return
			}
		}

		next.ServeHTTP(&addAllowHeadWriter{ResponseWriter: w}, r)
	})
}

type addAllowHeadWriter struct {
	http.ResponseWriter
	headerWritten bool
}

func (w *addAllowHeadWriter) WriteHeader(statusCode int) {
	w.headerWritten = true
	if statusCode == http.StatusMethodNotAllowed {
		allow := parseAllow(w.Header())
		if slices.Contains(allow, http.MethodGet) && !slices.Contains(allow, http.MethodHead) {
			w.Header().Add("Allow", http.MethodHead)
		}
	}
	w.ResponseWriter.WriteHeader(statusCode)
}

func (w *addAllowHeadWriter) Write(b []byte) (int, error) {
	if !w.headerWritten {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(b)
}

// parseAllow parses the Allow header into a slice of methods. It handles
// multiple Allow headers and comma-separated values.
func parseAllow(h http.Header) []string {
	allow := make([]string, 0, len(h["Allow"]))
	for _, v := range h["Allow"] {
		parts := strings.Split(v, ",")
		for i := range parts {
			allow = append(allow, strings.TrimSpace(parts[i]))
		}
	}
	return allow
}
