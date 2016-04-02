package chi

import "golang.org/x/net/context"

var _ context.Context = &Context{}

type ctxKey int

const (
	routeCtxKey ctxKey = iota
)

type Context struct {
	context.Context

	// URL parameter key and values
	Params params

	// Routing path override used by subrouters
	RoutePath string
}

func newContext(parent context.Context) *Context {
	rctx := &Context{}
	ctx := context.WithValue(parent, routeCtxKey, rctx)
	rctx.Context = ctx
	return rctx
}

func (x *Context) reset() {
	x.Params = x.Params[:0]
	x.RoutePath = ""
}
