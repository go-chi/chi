package middleware

import (
	"net/http"
	"strings"
)

// AllowContentEncoding enforces a whitelist of request Content-Encoding otherwise responds
// with a 415 Unsupported Media Type status.
//
// Content-Encoding may appear as multiple headers or as a single comma-separated
// list (RFC 9110). Both forms are accepted; every listed encoding must be allowed.
func AllowContentEncoding(contentEncoding ...string) func(next http.Handler) http.Handler {
	allowedEncodings := make(map[string]struct{}, len(contentEncoding))
	for _, encoding := range contentEncoding {
		allowedEncodings[strings.TrimSpace(strings.ToLower(encoding))] = struct{}{}
	}
	return func(next http.Handler) http.Handler {
		fn := func(w http.ResponseWriter, r *http.Request) {
			// skip check for empty content body or no Content-Encoding
			if r.ContentLength == 0 {
				next.ServeHTTP(w, r)
				return
			}
			// All encodings in the request must be allowed. Split comma-separated
			// lists so "Content-Encoding: gzip, deflate" is treated as two tokens.
			for _, headerVal := range r.Header["Content-Encoding"] {
				for _, encoding := range strings.Split(headerVal, ",") {
					enc := strings.TrimSpace(strings.ToLower(encoding))
					if enc == "" {
						continue
					}
					if _, ok := allowedEncodings[enc]; !ok {
						w.WriteHeader(http.StatusUnsupportedMediaType)
						return
					}
				}
			}
			next.ServeHTTP(w, r)
		}
		return http.HandlerFunc(fn)
	}
}
