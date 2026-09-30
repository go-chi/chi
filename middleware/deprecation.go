package middleware

import (
	"net/http"
	"strconv"
	"time"
)

// Deprecation sets the Deprecation header on the response, per RFC 9745.
// https://www.rfc-editor.org/rfc/rfc9745.html
//
// It can be used on a route or a route group. Each link is added as-is as a
// Link header, so it must be a full RFC 8288 value, e.g.
// `<https://example.com/deprecation>; rel="deprecation"`.
//
// Recommended lifecycle: deprecate first, then announce a removal date with
// [Sunset]. Middleware order doesn't matter.
func Deprecation(deprecatedAt time.Time, links ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !deprecatedAt.IsZero() {
				// RFC 9745 uses a Structured Field Date (RFC 9651), not an HTTP-date.
				w.Header().Set("Deprecation", "@"+strconv.FormatInt(deprecatedAt.Unix(), 10))

				for _, link := range links {
					w.Header().Add("Link", link)
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}
