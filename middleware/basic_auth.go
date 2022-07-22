package middleware

import (
	"net/http"
)

// BasicAuth implements a simple middleware handler for adding basic http auth to a route.
// authorize should return true if the username and password are correct, otherwise 401 will be returned.
// The returned contextKey and contextValue can be used to set values on the request context,
// for example a user struct. Values can be retrieved easily using middleware.GetValue.
func BasicAuth[V any](key any, authorize func(username, password string) (contextValue V, ok bool)) func(next http.Handler) http.Handler {
	return SetValue(key, func(w http.ResponseWriter, r *http.Request) (value V, ok bool) {
		user, pass, ok := r.BasicAuth()
		if !ok {
			w.WriteHeader(http.StatusUnauthorized)
			return value, false
		}

		v, ok := authorize(user, pass)
		if !ok {
			w.WriteHeader(http.StatusUnauthorized)
			return value, false
		}

		return v, true
	})
}
