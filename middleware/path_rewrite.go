package middleware

import (
	"net/http"
	"net/url"
	"strings"
)

// PathRewrite is a simple middleware which allows you to rewrite the request URL path.
func PathRewrite(old, new string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if before, after, found := strings.Cut(r.URL.Path, old); found && old != new {
				if r.URL.RawPath != "" {
					raw := r.URL.EscapedPath()
					start := escapedPrefixLen(raw, len(before))
					end := start + escapedPrefixLen(raw[start:], len(old))
					replacement := (&url.URL{Path: new}).EscapedPath()
					r.URL.RawPath = raw[:start] + replacement + raw[end:]
				}
				r.URL.Path = before + new + after
			}
			next.ServeHTTP(w, r)
		})
	}
}

// escapedPrefixLen returns the length of the escaped prefix for n decoded bytes.
func escapedPrefixLen(path string, n int) int {
	i := 0
	for ; n > 0; n-- {
		if path[i] == '%' {
			i += 3
		} else {
			i++
		}
	}
	return i
}
