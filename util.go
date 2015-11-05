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
	case Handler:
		cxh = t
	case func(context.Context, http.ResponseWriter, *http.Request):
		cxh = HandlerFunc(t)
	case http.Handler:
		cxh = HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
			t.ServeHTTP(w, r)
		})
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
	switch mw := middleware.(type) {
	default:
		panic(fmt.Sprintf("chi: unsupported handler signature: %T", mw))

	case func(Handler) Handler:
		return mw

	case func(http.Handler) http.Handler:
		return func(next Handler) Handler {
			return HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
				wfn := func(w http.ResponseWriter, r *http.Request) {
					next.ServeHTTPC(ctx, w, r)
				}
				mw(http.HandlerFunc(wfn)).ServeHTTP(w, r)
			})
		}
	}
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
