package middleware

import (
	"net/http"
	"time"

	"github.com/pressly/chi"
	"golang.org/x/net/context"
)

var (
	defaultTimeout = time.Second * 60
)

// Throttle is a middleware that limits number of currently processed requests
// at a time.
func Throttle(limit int, backloglimit int, timeout time.Duration) func(chi.Handler) chi.Handler {
	if limit < 1 {
		panic("middleware.Throttle expects limit > 0")
	}

	if backloglimit < limit {
		panic("middleware.Throttle expects backloglimit > limit")
	}

	if timeout == 0 {
		timeout = defaultTimeout
	}

	t := throttle{
		tokens:        make(chan token, limit),
		backlogtokens: make(chan token, backloglimit),
		timeout:       timeout,
	}

	// Filling tokens.
	for i := 0; i < backloglimit; i++ {
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
type throttle struct {
	h             chi.Handler
	tokens        chan token
	backlogtokens chan token
	timeout       time.Duration
}

// TODO: add support for a backlog

// ServeHTTPC implements chi.Handler interface.
func (t *throttle) ServeHTTPC(ctx context.Context, w http.ResponseWriter, r *http.Request) {
	timer := time.NewTimer(t.timeout)

	select {
	case <-timer.C:
		httpStatus(w, http.StatusServiceUnavailable)
		return
	case <-ctx.Done():
		httpStatus(w, http.StatusServiceUnavailable)
		return
	case btok := <-t.backlogtokens:
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
	}
}

func httpStatus(w http.ResponseWriter, statusCode int) {
	w.WriteHeader(statusCode)
	w.Write([]byte(http.StatusText(statusCode)))
}
