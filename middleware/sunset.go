package middleware

import (
	"net/http"
	"time"
)

// Sunset sets the Sunset header on the response, per RFC 8594.
// https://www.rfc-editor.org/rfc/rfc8594.html
//
// It can be used on a route or a route group. Each link is added as a Link
// header, e.g. `<https://example.com/sunset>; rel="sunset"`.
//
// Typically used after [Deprecation]: deprecate first, then announce the sunset.
func Sunset(sunsetAt time.Time, links ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !sunsetAt.IsZero() {
				w.Header().Set("Sunset", sunsetAt.UTC().Format(http.TimeFormat))

				for _, link := range links {
					w.Header().Add("Link", link)
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}
