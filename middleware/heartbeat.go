package middleware

import (
	"net/http"
	"strings"
)

// Heartbeat endpoint middleware useful to setting up a path like
// `/ping` that load balancers or uptime testing external services
// can make a request before hitting any routes. It's also convenient
// to place this above ACL middlewares as well.
func Heartbeat(endpoint string) func(http.Handler) http.Handler {
	return HeartbeatFunc(endpoint, func() []byte {
		return []byte(".")
	})
}

// HeartbeatFunc is similar to Heartbeat but dynamically allows for a dynamic
// payload to be returned
func HeartbeatFunc(endpoint string, payload func() []byte) func(http.Handler) http.Handler {
	f := func(h http.Handler) http.Handler {
		fn := func(w http.ResponseWriter, r *http.Request) {
			if r.Method == "GET" && strings.EqualFold(r.URL.Path, endpoint) {
				w.Header().Set("Content-Type", "text/plain")
				w.WriteHeader(http.StatusOK)
				w.Write(payload())
				return
			}
			h.ServeHTTP(w, r)
		}
		return http.HandlerFunc(fn)
	}
	return f
}
