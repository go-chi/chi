package chi

import (
	"context"
	"net/http"
)

var _ context.Context = &Context{}

type ctxKey int // TODO: use stdlib technique with just a struct and name with vars, easier to debug.

/*
// contextKey is a value for use with context.WithValue. It's used as
// a pointer so it fits in an interface{} without allocation.
type contextKey struct {
	name string
}

func (k *contextKey) String() string { return "net/http context value " + k.name }

var RouteCtxKey = &contextKey{"chi.RouteContext"}
*/

const (
	RouteCtxKey ctxKey = iota // TODO: export?
)

// A Context is the default routing context set on the root node of a
// request context to track URL parameters and an optional routing path.
type Context struct {
	context.Context

	// URL parameter key and values
	Params params

	// Routing path override used by subrouters
	RoutePath string
}

// TODO: do we add a ShutdownCh that tells us to stop listening etc...?
// or call it StopCh ? ...
// perhaps, just offer this as a middleware.... ctx.Value(middleware.StopCh).(chan struct{}) bad..
// .. hmm..

// NewRouteContext returns a new routing context object.
func NewRouteContext(parent context.Context) *Context {
	rctx := &Context{}
	ctx := context.WithValue(parent, RouteCtxKey, rctx)
	rctx.Context = ctx
	return rctx
}

// reset a routing context to its initial state.
func (x *Context) reset() {
	x.Params = x.Params[:0]
	x.RoutePath = ""
}

// RouteContext returns chi's routing context object that holds url params
// and a routing path for subrouters.
func RouteContext(ctx context.Context) *Context {
	rctx, _ := ctx.(*Context)
	if rctx == nil {
		rctx = ctx.Value(RouteCtxKey).(*Context)
	}
	return rctx
}

// URLParam returns the url parameter from an http.Request Context
func URLParam(r *http.Request, key string) string {
	if rctx := RouteContext(r.Context()); rctx != nil {
		return rctx.Params.Get(key)
	}
	return ""
}

// URLParamFromCtx returns a url parameter from the routing context.
func URLParamFromCtx(ctx context.Context, key string) string {
	if rctx := RouteContext(ctx); rctx != nil {
		return rctx.Params.Get(key)
	}
	return ""
}
