package middleware

import (
	"fmt"
	"net/http"
)

// BearerToken implements a simple middleware handler for adding bearer token auth to a route.
func BearerToken(token string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			bearerToken := r.Header.Get("Authorization")

			expected := fmt.Sprintf("Bearer %s", token)
			if bearerToken != expected {
				bearerTokenFailed(w)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

func bearerTokenFailed(w http.ResponseWriter) {
	w.WriteHeader(http.StatusUnauthorized)
}
