package chi

import (
	"context"
	"net"
	"net/http"
)

var (
	RouteCtxKey = &contextKey{"RouteContext"}
)

// Context is the default routing context set on the root node of a
// request context to track URL parameters and an optional routing path.
type Context struct {
	// Routing path override used by subrouters.
	RoutePath string

	// Routing pattern matching the path.
	RoutePattern string

	// Routing patterns throughout the lifecycle of the request,
	// across all connected routers.
	RoutePatterns []string

	// URL routing parameter keys and values.
	URLParams   []routeParams
	routeParams routeParams
}

// NewRouteContext returns a new routing Context object.
func NewRouteContext() *Context {
	return &Context{}
}

// reset a routing context to its initial state.
func (x *Context) reset() {
	x.RoutePath = ""
	x.RoutePattern = ""
	x.RoutePatterns = x.RoutePatterns[:0]

	x.URLParams = x.URLParams[:0]
	x.routeParams.keys = x.routeParams.keys[:0]
	x.routeParams.values = x.routeParams.values[:0]
}

func (x *Context) URLParam(key string) string {
	for s := len(x.URLParams) - 1; s >= 0; s-- {
		for k := len(x.URLParams[s].keys) - 1; k >= 0; k-- {
			if x.URLParams[s].keys[k] == key {
				return x.URLParams[s].values[k]
			}
		}
	}
	return ""
}

// RouteContext returns chi's routing Context object from a
// http.Request Context.
func RouteContext(ctx context.Context) *Context {
	return ctx.Value(RouteCtxKey).(*Context)
}

// URLParam returns the url parameter from a http.Request object.
func URLParam(r *http.Request, key string) string {
	if rctx := RouteContext(r.Context()); rctx != nil {
		return rctx.URLParam(key)
	}
	return ""
}

// URLParamFromCtx returns the url parameter from a http.Request Context.
func URLParamFromCtx(ctx context.Context, key string) string {
	if rctx := RouteContext(ctx); rctx != nil {
		return rctx.URLParam(key)
	}
	return ""
}

type routeParams struct {
	keys, values []string
}

// ServerBaseContext wraps an http.Handler to set the request context to the
// `baseCtx`.
func ServerBaseContext(h http.Handler, baseCtx context.Context) http.Handler {
	fn := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		baseCtx := baseCtx

		// Copy over default net/http server context keys
		if v, ok := ctx.Value(http.ServerContextKey).(*http.Server); ok {
			baseCtx = context.WithValue(baseCtx, http.ServerContextKey, v)
		}
		if v, ok := ctx.Value(http.LocalAddrContextKey).(net.Addr); ok {
			baseCtx = context.WithValue(baseCtx, http.LocalAddrContextKey, v)
		}

		h.ServeHTTP(w, r.WithContext(baseCtx))
	})
	return fn
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
