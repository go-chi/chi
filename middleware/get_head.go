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

			// Temporary routing context to look-ahead before routing the request
			tctx := chi.NewRouteContext()

			// Attempt to find a HEAD handler for the routing path, if not found, traverse
			// the router as through its a GET route, but proceed with the request
			// with the HEAD method.
			if !rctx.Routes.Match(tctx, "HEAD", routePath) {
				rctx.RouteMethod = "GET"
				rctx.RoutePath = routePath
				next.ServeHTTP(newGetHeadAllowWriter(w), r)
				return
			}
		}

		next.ServeHTTP(newGetHeadAllowWriter(w), r)
	})
}

// getHeadAllowWriter ensures that when GetHead is enabled, 405 Allow headers
// that advertise GET also advertise HEAD, since GetHead makes HEAD available
// via the GET handler.
type getHeadAllowWriter struct {
	http.ResponseWriter
	wroteHeader bool
}

func newGetHeadAllowWriter(w http.ResponseWriter) http.ResponseWriter {
	return &getHeadAllowWriter{ResponseWriter: w}
}

func (w *getHeadAllowWriter) WriteHeader(statusCode int) {
	if !w.wroteHeader {
		w.ensureHeadAllowed()
		w.wroteHeader = true
	}
	w.ResponseWriter.WriteHeader(statusCode)
}

func (w *getHeadAllowWriter) Write(b []byte) (int, error) {
	if !w.wroteHeader {
		w.ensureHeadAllowed()
		w.wroteHeader = true
	}
	return w.ResponseWriter.Write(b)
}

func (w *getHeadAllowWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (w *getHeadAllowWriter) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}

func (w *getHeadAllowWriter) ensureHeadAllowed() {
	allows := w.Header().Values("Allow")
	if len(allows) == 0 {
		return
	}

	hasGET, hasHEAD := false, false
	for _, method := range allows {
		switch method {
		case http.MethodGet:
			hasGET = true
		case http.MethodHead:
			hasHEAD = true
		}
	}
	if hasGET && !hasHEAD {
		w.Header().Add("Allow", http.MethodHead)
	}
}
