package middleware

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
)

// GetHead automatically route undefined HEAD requests to GET handlers.
//
// When a 405 Method Not Allowed response is emitted for a route whose
// Allow header lists GET, HEAD is also added to that header to reflect
// the implicit GET-to-HEAD routing this middleware provides.
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
				next.ServeHTTP(&getHeadAllowWriter{ResponseWriter: w}, r)
				return
			}
		}

		next.ServeHTTP(&getHeadAllowWriter{ResponseWriter: w}, r)
	})
}

// getHeadAllowWriter advertises HEAD support alongside GET in any
// 405 Method Not Allowed response. The methodNotAllowedHandler builds
// the Allow header from the route's registered methods, which doesn't
// include HEAD when only GET is registered, so the response would
// otherwise omit it.
type getHeadAllowWriter struct {
	http.ResponseWriter
	wroteHeader bool
}

func (w *getHeadAllowWriter) WriteHeader(status int) {
	if !w.wroteHeader && status == http.StatusMethodNotAllowed {
		hdr := w.ResponseWriter.Header()
		allow := hdr.Values("Allow")
		hasGet, hasHead := false, false
		for _, a := range allow {
			for _, m := range strings.Split(a, ",") {
				switch strings.TrimSpace(m) {
				case http.MethodGet:
					hasGet = true
				case http.MethodHead:
					hasHead = true
				}
			}
		}
		if hasGet && !hasHead {
			hdr.Add("Allow", http.MethodHead)
		}
	}
	w.wroteHeader = true
	w.ResponseWriter.WriteHeader(status)
}

func (w *getHeadAllowWriter) Write(b []byte) (int, error) {
	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(b)
}
