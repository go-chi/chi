package middleware

import (
	"net/http"
	"context"
)

// StatusClientClosedRequest represents a 499 Client Closed Request (Nginx) HTTP status.
// See: https://en.wikipedia.org/wiki/List_of_HTTP_status_codes
const StatusClientClosedRequest = 499

// CloseNotify is a middleware that cancels ctx when the underlying
// connection has gone away. It can be used to cancel long operations
// on the server when the client disconnects before the response is ready.
func CloseNotify(next http.Handler) http.Handler {
	fn := func(w http.ResponseWriter, r *http.Request) {
		cn, ok := w.(http.CloseNotifier)
		if !ok {
			panic("middleware.CloseNotify expects http.ResponseWriter to implement http.CloseNotifier interface")
		}
		closeNotifyCh := cn.CloseNotify()

		ctx, cancel := context.WithCancel(r.Context())
		defer cancel()

		go func() {
			select {
			case <-ctx.Done():
				return
			case <-closeNotifyCh:
				cancel()
				w.WriteHeader(StatusClientClosedRequest)
				return
			}
		}()

		r = r.WithContext(ctx)
		next.ServeHTTP(w, r)
	}

	return http.HandlerFunc(fn)
}
