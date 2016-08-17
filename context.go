package chi

import (
	"context"
	"net/http"
	"time"
)

var (
	RouteCtxKey = &contextKey{"RouteContext"}
)

var _ context.Context = &Context{}

// Context is the default routing context set on the root node of a
// request context to track URL parameters and an optional routing path.
type Context struct {
	// Parent context
	parent context.Context

	// URL routing parameter key and values.
	Params params

	// Routing path override used by subrouters.
	RoutePath string

	// Routing pattern matching the path.
	RoutePattern string

	// Routing patterns throughout the lifecycle of the request,
	// across all connected routers.
	RoutePatterns []string
}

// NewRouteContext returns a new routing Context object.
func NewRouteContext() *Context {
	return &Context{}
}

// reset a routing context to its initial state.
func (x *Context) reset() {
	x.parent = nil
	x.Params = x.Params[:0]
	x.RoutePath = ""
	x.RoutePattern = ""
	x.RoutePatterns = x.RoutePatterns[:0]
}

func (ctx *Context) Deadline() (deadline time.Time, ok bool) {
	return ctx.parent.Deadline()
}

func (ctx *Context) Done() <-chan struct{} {
	return ctx.parent.Done()
}

func (ctx *Context) Err() error {
	return ctx.parent.Err()
}

func (ctx *Context) Value(key interface{}) interface{} {
	if key == RouteCtxKey {
		return ctx
	}
	return ctx.parent.Value(key)
}

// RouteContext returns chi's routing Context object from a
// http.Request Context.
func RouteContext(ctx context.Context) *Context {
	return ctx.Value(RouteCtxKey).(*Context)
}

// URLParam returns the url parameter from a http.Request object.
func URLParam(r *http.Request, key string) string {
	if rctx := RouteContext(r.Context()); rctx != nil {
		return rctx.Params.Get(key)
	}
	return ""
}

// URLParam returns the url parameter from a http.Request Context.
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

// contextKey is a value for use with context.WithValue. It's used as
// a pointer so it fits in an interface{} without allocation. This technique
// for defining context keys was copied from Go 1.7's new use of context in net/http.
type contextKey struct {
	name string
}

func (k *contextKey) String() string {
	return "chi context value " + k.name
}
