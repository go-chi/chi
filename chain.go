package chi

import (
	"net/http"
	"reflect"
	"sync"
)

// pointerMiddlewareHandlers records pointer-typed http.Handler values returned
// by middleware factories. A singleton that stores next on itself is reused
// across Group() chains and silently misroutes (see #995); panic instead.
var pointerMiddlewareHandlers sync.Map

// Chain returns a Middlewares type from a slice of middleware handlers.
func Chain(middlewares ...func(http.Handler) http.Handler) Middlewares {
	return Middlewares(middlewares)
}

// Handler builds and returns a http.Handler from the chain of middlewares,
// with `h http.Handler` as the final handler.
func (mws Middlewares) Handler(h http.Handler) http.Handler {
	return &ChainHandler{h, chain(mws, h), mws}
}

// HandlerFunc builds and returns a http.Handler from the chain of middlewares,
// with `h http.Handler` as the final handler.
func (mws Middlewares) HandlerFunc(h http.HandlerFunc) http.Handler {
	return &ChainHandler{h, chain(mws, h), mws}
}

// ChainHandler is a http.Handler with support for handler composition and
// execution.
type ChainHandler struct {
	Endpoint    http.Handler
	chain       http.Handler
	Middlewares Middlewares
}

func (c *ChainHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	c.chain.ServeHTTP(w, r)
}

// chain builds a http.Handler composed of an inline middleware stack and endpoint
// handler in the order they are passed.
func chain(middlewares []func(http.Handler) http.Handler, endpoint http.Handler) http.Handler {
	// Return ahead of time if there aren't any middlewares for the chain
	if len(middlewares) == 0 {
		return endpoint
	}

	// Wrap the end handler with the middleware chain
	h := middlewares[len(middlewares)-1](endpoint)
	rememberMiddlewareHandler(h)
	for i := len(middlewares) - 2; i >= 0; i-- {
		h = middlewares[i](h)
		rememberMiddlewareHandler(h)
	}

	return h
}

func rememberMiddlewareHandler(h http.Handler) {
	v := reflect.ValueOf(h)
	if v.Kind() != reflect.Ptr || v.IsNil() {
		return
	}
	id := v.Pointer()
	if _, loaded := pointerMiddlewareHandlers.LoadOrStore(id, struct{}{}); loaded {
		panic("chi: middleware returned the same http.Handler instance more than once; return a new handler each call (do not store next on a singleton)")
	}
}
