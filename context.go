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

	// URL parameter key and values.
	Params params

	// Routing path override used by subrouters.
	RoutePath string

	// Routing pattern matching the path.
	RoutePattern string

	// Routing patterns throughout the lifecycle of the request,
	// across all connected routers.
	RoutePatterns []string
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
	x.RoutePattern = ""
	x.RoutePatterns = x.RoutePatterns[:0]
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

type param struct {
	Key, Value string
}

type params []param

func (ps *params) Add(key string, value string) {
	*ps = append(*ps, param{key, value})
}

func (ps params) Get(key string) string {
	for _, p := range ps {
		if p.Key == key {
			return p.Value
		}
	}
	return ""
}

func (ps *params) Set(key string, value string) {
	idx := -1
	for i, p := range *ps {
		if p.Key == key {
			idx = i
			break
		}
	}
	if idx < 0 {
		(*ps).Add(key, value)
	} else {
		(*ps)[idx] = param{key, value}
	}
}

func (ps *params) Del(key string) string {
	for i, p := range *ps {
		if p.Key == key {
			*ps = append((*ps)[:i], (*ps)[i+1:]...)
			return p.Value
		}
	}
	return ""
}
