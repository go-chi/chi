package middleware

import (
	"net/http"
	"time"

	"github.com/pressly/chi"
	"golang.org/x/net/context"
)

const StatusServerTimeout = 504

// Timeout cancels ctx after a given timeout.
func Timeout(timeout time.Duration) func(next chi.Handler) chi.Handler {
	return func(next chi.Handler) chi.Handler {
		fn := func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
			ctx, cancel := context.WithTimeout(ctx, timeout)
			defer func() {
				if ctx.Err() == context.DeadlineExceeded {
					w.WriteHeader(StatusServerTimeout)
				}
				cancel()
			}()

			next.ServeHTTPC(ctx, w, r)
		}
		return chi.HandlerFunc(fn)
	}
}
