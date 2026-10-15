package middleware

import (
	"net/http"
	"strings"
)

// AllowContentEncoding enforces a whitelist of request Content-Encoding otherwise responds
// with a 415 Unsupported Media Type status.
func AllowContentEncoding(contentEncoding ...string) func(next http.Handler) http.Handler {
	allowedEncodings := make(map[string]struct{}, len(contentEncoding))
	for _, encoding := range contentEncoding {
		allowedEncodings[strings.TrimSpace(strings.ToLower(encoding))] = struct{}{}
	}
	return func(next http.Handler) http.Handler {
		fn := func(w http.ResponseWriter, r *http.Request) {
			requestEncodings := r.Header["Content-Encoding"]
			// skip check for empty content body or no Content-Encoding
			if r.ContentLength == 0 {
				next.ServeHTTP(w, r)
				return
			}
			// All encodings in the request must be allowed.
			// A single Content-Encoding header may list several codings
			// separated by commas (RFC 9110), and net/http keeps that as one
			// slice element. Split so "gzip, deflate" is checked as gzip and
			// deflate, not as the literal string "gzip, deflate".
			for _, encoding := range requestEncodings {
				for _, part := range strings.Split(encoding, ",") {
					part = strings.TrimSpace(strings.ToLower(part))
					if part == "" {
						continue
					}
					if _, ok := allowedEncodings[part]; !ok {
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
