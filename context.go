package chi

import (
	"context"
	"net"
	"net/http"
	"strconv"
)

var (
	RouteCtxKey = &contextKey{"RouteContext"}
)

// Context is the default routing context set on the root node of a
// request context to track URL parameters and an optional routing path.
type Context struct {
	// URL routing parameter key and values.
	URLParams params

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
	x.URLParams = x.URLParams[:0]
	x.RoutePath = ""
	x.RoutePattern = ""
	x.RoutePatterns = x.RoutePatterns[:0]
}

// RouteContext returns chi's routing Context object from a
// http.Request Context.
func RouteContext(ctx context.Context) *Context {
	return ctx.Value(RouteCtxKey).(*Context)
}

// URLParam returns the url parameter from a http.Request object.
func URLParam(r *http.Request, key string) string {
	if rctx := RouteContext(r.Context()); rctx != nil {
		return rctx.URLParams.Get(key)
	}
	return ""
}

// URLParamInt returns the url parameter from a http.Request object converted to int64.
func URLParamInt(r *http.Request, key string) int64 {
	v, _ := strconv.ParseInt(URLParam(r, key), 10, 64)
	return v
}

// URLParamUint returns the url parameter from a http.Request object converted to uint64.
func URLParamUint(r *http.Request, key string) uint64 {
	v, _ := strconv.ParseUint(URLParam(r, key), 10, 64)
	return v
}

// URLParamBool returns the url parameter from a http.Request object converted to boolean.
func URLParamBool(r *http.Request, key string) bool {
	v, _ := strconv.ParseBool(URLParam(r, key))
	return v
}

// URLParamFloat returns the url parameter from a http.Request object converted to float64.
func URLParamFloat(r *http.Request, key string) float64 {
	v, _ := strconv.ParseFloat(URLParam(r, key), 64)
	return v
}

// URLParamFromCtx returns the url parameter from a http.Request Context.
func URLParamFromCtx(ctx context.Context, key string) string {
	if rctx := RouteContext(ctx); rctx != nil {
		return rctx.URLParams.Get(key)
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

// ServerBaseContext wraps an http.Handler to set the request context to the
// `baseCtx`.
func ServerBaseContext(h http.Handler, baseCtx context.Context) http.Handler {
	fn := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()

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
