package middleware

import (
	"net/http"

	"github.com/pressly/chi"
	"golang.org/x/net/context"
)

// Throttle is a middleware that limits number of currently
// processed requests at a time.
func Throttle(limit int) func(chi.Handler) chi.Handler {
	if limit <= 0 {
		panic("middleware.Throttle expects limit > 0")
	}

	t := throttler{
		tokens: make(chan token, limit),
	}
	for i := 0; i < limit; i++ {
		t.tokens <- token{}
	}

	fn := func(h chi.Handler) chi.Handler {
		t.h = h
		return &t
	}

	return fn
}

// token represents a request that is being processed.
type token struct{}

// throttler limits number of currently processed requests at a time.
type throttler struct {
	h      chi.Handler
	tokens chan token
}

// ServeHTTPC implements chi.Handler interface.
func (t *throttler) ServeHTTPC(ctx context.Context, w http.ResponseWriter, r *http.Request) {
	select {
	case <-ctx.Done():
		return
	case tok := <-t.tokens:
		defer func() {
			t.tokens <- tok
		}()
		t.h.ServeHTTPC(ctx, w, r)
	}
}
