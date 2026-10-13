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
	_, params, err := mime.ParseMediaType(normalizeHTTPQuotedPairs(ce))
	if err == nil {
		return slices.Contains(charsets, strings.ToLower(params["charset"]))
	}

	// Preserve the existing handling of absent or non-MIME header values.
	_, ce = split(strings.ToLower(ce), ";")
	_, ce = split(ce, "charset=")
	ce, _ = split(ce, ";")
	return slices.Contains(charsets, ce)
}

// mime.ParseMediaType preserves some quoted pairs for legacy browser file paths.
// HTTP quoted pairs always represent the byte following the backslash.
func normalizeHTTPQuotedPairs(value string) string {
	if strings.IndexByte(value, '\\') < 0 {
		return value
	}
	var normalized strings.Builder
	normalized.Grow(len(value))
	quoted := false
	for i := 0; i < len(value); i++ {
		c := value[i]
		if c == '"' {
			quoted = !quoted
		}
		if quoted && c == '\\' && i+1 < len(value) {
			i++
			c = value[i]
			// Keep escapes that the MIME parser already decodes correctly.
			if c == '"' || c == '\\' {
				normalized.WriteByte('\\')
			}
		}
		normalized.WriteByte(c)
	}
	return normalized.String()
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
