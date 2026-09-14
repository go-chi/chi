package middleware

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
)

// GetHead automatically route undefined HEAD requests to GET handlers.
//
// Because this makes HEAD valid wherever GET is registered, 405 responses
// also list HEAD in the Allow header when GET is already present.
func GetHead(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ww := &getHeadAllowWriter{ResponseWriter: w}
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
				next.ServeHTTP(ww, r)
				return
			}
		}

		next.ServeHTTP(ww, r)
	})
}

// getHeadAllowWriter adds HEAD to a 405 Allow list when GET is already allowed.
type getHeadAllowWriter struct {
	http.ResponseWriter
	wroteHeader bool
}

func (w *getHeadAllowWriter) WriteHeader(code int) {
	if !w.wroteHeader && code == http.StatusMethodNotAllowed {
		if allowHasMethod(w.Header(), http.MethodGet) && !allowHasMethod(w.Header(), http.MethodHead) {
			w.Header().Add("Allow", http.MethodHead)
		}
	}
	w.wroteHeader = true
	w.ResponseWriter.WriteHeader(code)
}

func (w *getHeadAllowWriter) Write(b []byte) (int, error) {
	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(b)
}

func (w *getHeadAllowWriter) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}

func allowHasMethod(h http.Header, method string) bool {
	for _, v := range h.Values("Allow") {
		for _, p := range strings.Split(v, ",") {
			if strings.EqualFold(strings.TrimSpace(p), method) {
				return true
			}
		}
	}
	return false
}
