package chi

import "context"

var _ context.Context = &Context{}

type ctxKey int

const (
	routeCtxKey ctxKey = iota
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

// neContext returns a new routing context object.
func newContext(parent context.Context) *Context {
	rctx := &Context{}
	ctx := context.WithValue(parent, routeCtxKey, rctx)
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
