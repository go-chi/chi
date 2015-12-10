package middleware

import (
	"net/http"
	"time"

	"github.com/pressly/chi"
	"golang.org/x/net/context"
)

var (
	defaultThrottleTimeout = time.Second * 60
)

// Throttle is a middleware that limits number of currently processed requests
// at a time.
func Throttle(limit int) func(chi.Handler) chi.Handler {
	return ThrottleBacklog(limit, 0, defaultThrottleTimeout)
}

// ThrottleBacklog is a middleware that limits number of currently processed
// requests at a time and provides a backlog for holding a finite number of
// pending requests.
func ThrottleBacklog(limit int, backloglimit int, timeout time.Duration) func(chi.Handler) chi.Handler {
	if limit < 1 {
		panic("middleware.Throttle expects limit > 0")
	}

	if backloglimit < 0 {
		panic("middleware.Throttle expects backloglimit to be positive")
	}

	t := throttler{
		tokens:        make(chan token, limit),
		backlogtokens: make(chan token, limit+backloglimit),
		timeout:       timeout,
	}

	// Filling tokens.
	for i := 0; i < limit+backloglimit; i++ {
		if i < limit {
			t.tokens <- token{}
		}
		t.backlogtokens <- token{}
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
	h             chi.Handler
	tokens        chan token
	backlogtokens chan token
	timeout       time.Duration
}

// TODO: add support for a backlog

// ServeHTTPC implements chi.Handler interface.
func (t *throttler) ServeHTTPC(ctx context.Context, w http.ResponseWriter, r *http.Request) {

	select {
	case <-ctx.Done():
		httpStatus(w, http.StatusServiceUnavailable)
		return
	case btok := <-t.backlogtokens:
		timer := time.NewTimer(t.timeout)

		defer func() {
			t.backlogtokens <- btok
		}()

		select {
		case <-timer.C:
			httpStatus(w, http.StatusGatewayTimeout)
			return
		case <-ctx.Done():
			httpStatus(w, http.StatusServiceUnavailable)
			return
		case tok := <-t.tokens:
			defer func() {
				t.tokens <- tok
			}()
			t.h.ServeHTTPC(ctx, w, r)
		}
	default:
		httpStatus(w, http.StatusServiceUnavailable)
		return
	}
}
