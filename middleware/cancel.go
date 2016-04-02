package middleware

import (
	"net/http"

	"github.com/pressly/chi"
	"golang.org/x/net/context"
)

// Cancel is a middleware that cancels ctx when the underlying handlers
// return. It enforces any running goroutines (or ctxhttp clients)
// created down the chain and listening on ctx.Done() channel to stop
// immediately. Useful for preventing leaks on synchronous operations.
// It forces to use context.Background() instead of ctx for all
// goroutines that should live even after the request is processed.
func Cancel(next chi.Handler) chi.Handler {
	fn := func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithCancel(ctx)
		defer cancel()

		next.ServeHTTPC(ctx, w, r)
	}
	return chi.HandlerFunc(fn)
}
