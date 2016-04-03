package chi

import (
	"net/http"

	"golang.org/x/net/context"
)

// NewRouter returns a new Mux object that implements the Router interface.
// It accepts an optional parent context.Context argument used by all
// request contexts useful for signaling a server shutdown.
func NewRouter(parent ...context.Context) *Mux {
	return NewMux(parent...)
}

// A Router consisting of the core routing methods used by chi's Mux.
//
// NOTE, the plan: hopefully once net/context makes it into the stdlib and
// net/http supports a request context, we will remove the chi.Handler
// interface, and the Router argument types will be http.Handler instead
// of interface{}.
type Router interface {
	http.Handler
	Handler

	Use(middlewares ...interface{})
	Group(fn func(r Router)) Router
	Route(pattern string, fn func(r Router)) Router
	Mount(pattern string, handlers ...interface{})

	Handle(pattern string, handlers ...interface{})
	NotFound(h HandlerFunc)

	Connect(pattern string, handlers ...interface{})
	Head(pattern string, handlers ...interface{})
	Get(pattern string, handlers ...interface{})
	Post(pattern string, handlers ...interface{})
	Put(pattern string, handlers ...interface{})
	Patch(pattern string, handlers ...interface{})
	Delete(pattern string, handlers ...interface{})
	Trace(pattern string, handlers ...interface{})
	Options(pattern string, handlers ...interface{})
}

// Handler is like net/http's http.Handler, but also includes a
// mechanism for serving requests with a context.
type Handler interface {
	ServeHTTPC(context.Context, http.ResponseWriter, *http.Request)
}

// HandlerFunc is like net/http's http.HandlerFunc, but supports a context
// object.
type HandlerFunc func(context.Context, http.ResponseWriter, *http.Request)

// ServeHTTPC wraps ServeHTTP with a context parameter.
func (h HandlerFunc) ServeHTTPC(ctx context.Context, w http.ResponseWriter, r *http.Request) {
	h(ctx, w, r)
}

// ServeHTTP provides compatibility with http.Handler.
func (h HandlerFunc) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h(context.Background(), w, r)
}

// RouteContext returns chi's routing context object that holds url params
// and a routing path for subrouters.
func RouteContext(ctx context.Context) *Context {
	rctx, _ := ctx.(*Context)
	if rctx == nil {
		rctx = ctx.Value(routeCtxKey).(*Context)
	}
	return rctx
}

// URLParam returns a url paramter from the routing context.
func URLParam(ctx context.Context, key string) string {
	if rctx := RouteContext(ctx); rctx != nil {
		return rctx.Params.Get(key)
	}
	return ""
}
