package middleware

import (
	"net/http"

	"github.com/pressly/chi"
	"golang.org/x/net/context"
)

// WithValue is a middleware that sets a given key/value in a context chain.
func WithValue(key interface{}, val interface{}) func(next chi.Handler) chi.Handler {
	return func(next chi.Handler) chi.Handler {
		fn := func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
			ctx = context.WithValue(ctx, key, val)
			next.ServeHTTPC(ctx, w, r)
		}
		return chi.HandlerFunc(fn)
	}
}
