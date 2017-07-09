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
// request context to track route patterns, URL parameters and
// an optional routing path.
type Context struct {
	// Routing path override used during the route search.
	// See Mux#routeHTTP method.
	RoutePath string

	// Routing pattern stack throughout the lifecycle of the request,
	// across all connected routers. It is a record of all matching
	// patterns across a stack of sub-routers.
	RoutePatterns []string

	// URLParams are the stack of routeParams captured during the
	// routing lifecycle across a stack of sub-routers.
	URLParams RouteParamsStack

	// The endpoint routing pattern that matched the request URI path
	// or `RoutePath` of the current sub-router. This value will update
	// during the lifecycle of a request passing through a stack of
	// sub-routers.
	routePattern string

	// Route parameters matched for the current sub-router. It is
	// intentionally unexported so it cant be tampered.
	routeParams RouteParams

	// methodNotAllowed hint
	methodNotAllowed bool
}

// NewRouteContext returns a new routing Context object.
func NewRouteContext() *Context {
	return &Context{}
}

// reset a routing context to its initial state.
func (x *Context) reset() {
	x.RoutePath = ""
	x.RoutePatterns = x.RoutePatterns[:0]
	x.URLParams = x.URLParams[:0]

	x.routePattern = ""
	x.routeParams.Keys = x.routeParams.Keys[:0]
	x.routeParams.Values = x.routeParams.Values[:0]
	x.methodNotAllowed = false
}

func (x *Context) URLParam(key string) string {
	for s := len(x.URLParams) - 1; s >= 0; s-- {
		for k := len(x.URLParams[s].Keys) - 1; k >= 0; k-- {
			if x.URLParams[s].Keys[k] == key {
				return x.URLParams[s].Values[k]
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

type RouteParams struct {
	Keys, Values []string
}

type RouteParamsStack []RouteParams

// Add will append a URL parameter to the end of the route param stack
func (s *RouteParamsStack) Add(key, value string) {
	x := len(*s) - 1
	if x < 0 {
		*s = append(*s, RouteParams{})
		x = 0
	}
	(*s)[x].Keys = append((*s)[x].Keys, key)
	(*s)[x].Values = append((*s)[x].Values, value)
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
