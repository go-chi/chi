package middleware

import (
	"net/http"
	"time"
)

// Sunset set Deprecation/Sunset header to response
// This can be used to enable Sunset in a route or a route group
// For more at: https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-deprecation-header-02
func Sunset(sunsetAt *time.Time, links ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if sunsetAt != nil {
				w.Header().Set("Sunset", sunsetAt.Format(http.TimeFormat))
				w.Header().Set("Deprecation", sunsetAt.Format(http.TimeFormat))

				for i, link := range links {
					if i == 0 {
						w.Header().Set("Link", link)
						continue
					}
					w.Header().Add("Link", link)
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}
