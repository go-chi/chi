package middleware

import (
	"net/http"
	"time"
)

// Sunset sets the Sunset header on the response, per RFC 8594.
// https://www.rfc-editor.org/rfc/rfc8594.html
//
// It can be used on a route or a route group. Each link is added as-is as a
// Link header, so it must be a full RFC 8288 value, e.g.
// `<https://example.com/sunset>; rel="sunset"`.
//
// It panics if sunsetAt is the zero time, which is usually an unset value.
//
// Recommended lifecycle: deprecate first with [Deprecation], then announce the
// sunset. Middleware order doesn't matter.
func Sunset(sunsetAt time.Time, links ...string) func(http.Handler) http.Handler {
	if sunsetAt.IsZero() {
		panic("middleware.Sunset: sunsetAt must not be the zero time")
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Sunset", sunsetAt.UTC().Format(http.TimeFormat))

			for _, link := range links {
				w.Header().Add("Link", link)
			}
			next.ServeHTTP(w, r)
		})
	}
}
