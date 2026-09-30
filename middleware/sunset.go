package middleware

import (
	"net/http"
	"time"
)

// Sunset announces when a route will stop working, per RFC 8594.
// https://www.rfc-editor.org/rfc/rfc8594.html
//
// Use it once you know the removal date, and keep [Deprecation] on the same
// route. Sunset alone is valid, but clients get no "stop using this" signal.
// Middleware order doesn't matter.
//
// sunsetAt is a future date, and should not be before the deprecation date.
// After it, remove the route or return 410 Gone.
// It panics if sunsetAt is the zero time, which is usually an unset value.
// Pass a real date, or skip the middleware when no date is set.
//
// Each link is added as-is as a Link header, so it must be a full RFC 8288
// value, e.g. `<https://example.com/migrate>; rel="sunset"`.
func Sunset(sunsetAt time.Time, links ...string) func(http.Handler) http.Handler {
	if sunsetAt.IsZero() {
		panic("middleware.Sunset: sunsetAt must not be zero")
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
