package middleware

import (
	"net/http"

	"github.com/pressly/chi"
	"golang.org/x/net/context"
)

const StatusClientDisconnected = -1

// CloseNotify cancels the ctx when the underlying connection has gone away.
// This middleware can be used to cancel long operations on the server
// if the client has disconnected before the response is ready.
func CloseNotify(next chi.Handler) chi.Handler {
	fn := func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
		cn, ok := w.(http.CloseNotifier)
		if !ok {
			panic("middleware.CloseNotify expects http.ResponseWriter to implement http.CloseNotifier interface")
		}

		ctx, cancel := context.WithCancel(ctx)
		defer cancel()

		go func() {
			select {
			case <-ctx.Done():
				return
			case <-cn.CloseNotify():
				w.WriteHeader(StatusClientDisconnected)
				cancel()
				return
			}
		}()

		next.ServeHTTPC(ctx, w, r)
	}

	return chi.HandlerFunc(fn)
}
