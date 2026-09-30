package middleware

import (
	"net/http"
	"strconv"
	"time"
)

// Deprecation marks a route as deprecated, per RFC 9745.
// https://www.rfc-editor.org/rfc/rfc9745.html
//
// Use it from the day you decide to retire a route. The route keeps working,
// and clients are told to migrate. When you know the removal date, add [Sunset].
// Middleware order doesn't matter.
//
// deprecatedAt is when the route was, or will be, deprecated. A past date is fine.
// It panics if deprecatedAt is the zero time, which is usually an unset value.
// Pass a real date, or skip the middleware when no date is set.
//
// Each link is added as-is as a Link header, so it must be a full RFC 8288
// value, e.g. `<https://example.com/migrate>; rel="deprecation"`.
func Deprecation(deprecatedAt time.Time, links ...string) func(http.Handler) http.Handler {
	if deprecatedAt.IsZero() {
		panic("middleware.Deprecation: deprecatedAt must not be zero")
	}

	// RFC 9745 uses a Structured Field Date (RFC 9651), not an HTTP-date.
	value := "@" + strconv.FormatInt(deprecatedAt.Unix(), 10)

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Deprecation", value)

			for _, link := range links {
				w.Header().Add("Link", link)
			}
			next.ServeHTTP(w, r)
		})
	}
}
