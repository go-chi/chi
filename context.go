package chi

import (
	"context"
	"net/http"
)

var (
	RouteCtxKey = &contextKey{"RouteContext"}
)

var _ context.Context = &Context{}

// A Context is the default routing context set on the root node of a
// request context to track URL parameters and an optional routing path.
type Context struct {
	context.Context

	// URL parameter key and values
	Params params

	// Routing path override used by subrouters
	RoutePath string
}

// NewRouteContext returns a new routing context object.
func NewRouteContext() *Context {
	rctx := &Context{}
	ctx := context.WithValue(context.Background(), RouteCtxKey, rctx)
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

// contextKey is a value for use with context.WithValue. It's used as
// a pointer so it fits in an interface{} without allocation. This technique
// for defining context keys was copied from Go 1.7's new use of context in net/http.
type contextKey struct {
	name string
}

func (k *contextKey) String() string {
	return "chi context value " + k.name
}
