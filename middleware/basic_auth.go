package middleware

import (
	"crypto/subtle"
	"net/http"
	"strconv"
)

// BasicAuth implements a simple middleware handler for adding basic http auth to a route.
func BasicAuth(realm string, creds map[string]string) func(next http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user, pass, ok := r.BasicAuth()
			if !ok {
				basicAuthFailed(w, realm)
				return
			}

			credPass, credUserOk := creds[user]
			if !credUserOk || subtle.ConstantTimeCompare([]byte(pass), []byte(credPass)) != 1 {
				basicAuthFailed(w, realm)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

func basicAuthFailed(w http.ResponseWriter, realm string) {
	w.Header().Add("WWW-Authenticate", "Basic realm="+strconv.Quote(realm))
	w.WriteHeader(http.StatusUnauthorized)
}
