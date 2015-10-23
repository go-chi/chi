package chi

import (
	"fmt"
	"net/http"

	"golang.org/x/net/context"
)

// Build a chained chi.Handler from a list of middlewares
func chain(middlewares []interface{}, handlers ...interface{}) Handler {
	// join a middleware stack with inline middlewares
	mws := append(middlewares, handlers[:len(handlers)-1]...)

	// request handler
	handler := handlers[len(handlers)-1]

	// Assert the types in the middleware chain
	for _, mw := range mws {
		assertMiddleware(mw)
	}

	// Set the request handler to a context handler type
	var cxh Handler
	switch t := handler.(type) {
	default:
		panic(fmt.Sprintf("chi: unsupported handler signature: %T", t))
		// case http.Handler:
		// TODO: accept http.Handler too .. will have to get wrapped..
	case Handler:
		cxh = t
	case func(context.Context, http.ResponseWriter, *http.Request):
		cxh = HandlerFunc(t)
	case func(http.ResponseWriter, *http.Request):
		cxh = HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
			t(w, r)
		})
	}

	// Return ahead of time if there aren't any middlewares for the chain
	if len(mws) == 0 {
		return cxh
	}

	// Wrap the end handler with the middleware chain
	h := mwrap(mws[len(mws)-1])(cxh)
	for i := len(mws) - 2; i >= 0; i-- {
		f := mwrap(mws[i])
		h = f(h)
	}

	return h
}

// Wrap http.Handler middleware to chi.Handler middlewares
func mwrap(middleware interface{}) func(Handler) Handler {
	mw := func(cxh Handler) Handler {
		return HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
			wFn := func(ww http.ResponseWriter, rr *http.Request) {
				cxh.ServeHTTPC(ctx, ww, rr)
			}
			wFnC := func(ctx context.Context, ww http.ResponseWriter, rr *http.Request) {
				cxh.ServeHTTPC(ctx, ww, rr)
			}

			switch mw := middleware.(type) {
			default:
				panic(fmt.Sprintf("chi: unsupported handler signature: %T", mw))
			case func(http.Handler) http.Handler:
				h := mw(http.HandlerFunc(wFn)).ServeHTTP
				h(w, r)
			case func(Handler) Handler:
				h := mw(HandlerFunc(wFnC)).ServeHTTPC
				h(ctx, w, r)
			}
		})
	}
	return mw
}

// Runtime type checking of the middleware signature
func assertMiddleware(middleware interface{}) interface{} {
	switch t := middleware.(type) {
	default:
		panic(fmt.Sprintf("chi: unsupported middleware signature: %T", t))
	case func(http.Handler) http.Handler:
	case func(Handler) Handler:
	}
	return middleware
}
