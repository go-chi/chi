package middleware

import (
	"mime"
	"net/http"
	"slices"
	"strings"
)

// ContentCharset generates a handler that writes a 415 Unsupported Media Type response if none of the charsets match.
// An empty charset will allow requests with no Content-Type header or no specified charset.
// Requests without a body (ContentLength == 0) are always allowed.
// Quoted charset values, such as charset="UTF-8", are accepted.
func ContentCharset(charsets ...string) func(next http.Handler) http.Handler {
	for i, c := range charsets {
		charsets[i] = strings.ToLower(c)
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.ContentLength == 0 {
				next.ServeHTTP(w, r)
				return
			}

			if !contentEncoding(r.Header.Get("Content-Type"), charsets...) {
				w.WriteHeader(http.StatusUnsupportedMediaType)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// Check the content encoding against a list of acceptable values.
func contentEncoding(ce string, charsets ...string) bool {
	_, params, err := mime.ParseMediaType(ce)
	if err == nil {
		return slices.Contains(charsets, strings.ToLower(params["charset"]))
	}

	// Keep the previous lenient handling when the header is not a valid media type.
	_, ce = split(strings.ToLower(ce), ";")
	_, ce = split(ce, "charset=")
	ce, _ = split(ce, ";")
	return slices.Contains(charsets, ce)
}

// Split a string in two parts, cleaning any whitespace.
func split(str, sep string) (string, string) {
	a, b, found := strings.Cut(str, sep)
	a = strings.TrimSpace(a)
	if found {
		b = strings.TrimSpace(b)
	}

	return a, b
}
