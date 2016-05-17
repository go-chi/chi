package chi

import "golang.org/x/net/context"

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

// NewContext returns a new routing context object.
func NewContext() *Context {
	rctx := &Context{}
	ctx := context.WithValue(context.Background(), routeCtxKey, rctx)
	rctx.Context = ctx
	return rctx
}

// reset a routing context to its initial state.
func (x *Context) reset() {
	x.Params = x.Params[:0]
	x.RoutePath = ""
}
