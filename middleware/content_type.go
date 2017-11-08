package middleware

import (
	"net/http"
	"strings"
)

// AllowContentType enforces a whitelist of request Content-Types otherwise responds
// with a 415 Unsupported Media Type status.
func AllowContentType(contentTypes ...string) func(next http.Handler) http.Handler {
	cT := []string{}
	for _, t := range contentTypes {
		cT = append(cT, strings.ToLower(t))
	}

	return func(next http.Handler) http.Handler {
		fn := func(w http.ResponseWriter, r *http.Request) {
			s := strings.ToLower(strings.TrimSpace(strings.Split(r.Header.Get("Content-Type"), ";")[0]))

			f := false
			for _, t := range cT {
				if t == s {
					f = true
					break
				}
			}

			if !f {
				w.WriteHeader(http.StatusUnsupportedMediaType)
				return
			}

			next.ServeHTTP(w, r)
		}
		return http.HandlerFunc(fn)
	}
}
