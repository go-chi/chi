package chi

import (
	"fmt"
	"net/http"
	"sync"

	"golang.org/x/net/context"
)

var _ Router = &Mux{}

// A Mux is a simple HTTP route multiplexer that parses a request path,
// records any URL params, and executes an end handler. It implements
// the http.Handler interface and is friendly with the standard library.
//
// Mux is designed to be fast, minimal and offer a powerful API for building
// modular HTTP services with a large set of handlers. It's particularly useful
// for writing large REST API services that break a handler into many smaller
// parts composed of middlewares and end handlers.
type Mux struct {
	// The middleware stack, supporting..
	// func(http.Handler) http.Handler and func(chi.Handler) chi.Handler
	middlewares []interface{}

	// The radix trie router
	router *treeRouter

	// The mux handler, chained middleware stack and tree router
	handler Handler

	// Controls the behaviour of middleware chain generation when a mux
	// is registered as an inline group inside another mux.
	inline bool

	// Routing context pool
	pool sync.Pool
}

type methodTyp int

const (
	mCONNECT methodTyp = 1 << iota
	mDELETE
	mGET
	mHEAD
	mOPTIONS
	mPATCH
	mPOST
	mPUT
	mTRACE

	mALL methodTyp = mCONNECT | mDELETE | mGET | mHEAD | mOPTIONS |
		mPATCH | mPOST | mPUT | mTRACE
)

var methodMap = map[string]methodTyp{
	"CONNECT": mCONNECT,
	"DELETE":  mDELETE,
	"GET":     mGET,
	"HEAD":    mHEAD,
	"OPTIONS": mOPTIONS,
	"PATCH":   mPATCH,
	"POST":    mPOST,
	"PUT":     mPUT,
	"TRACE":   mTRACE,
}

// NewMux returns a new Mux object with an optional parent context.
func NewMux() *Mux {
	mux := &Mux{router: newTreeRouter(), handler: nil}
	mux.pool.New = func() interface{} {
		return NewContext()
	}
	return mux
}

// Use appends a middleware handler to the Mux middleware stack.
func (mx *Mux) Use(mws ...interface{}) {
	for _, mw := range mws {
		mx.middlewares = append(mx.middlewares, assertMiddleware(mw))
	}
}

// Handle adds a route for all http methods that match the `pattern`
// for the `handlers` chain.
func (mx *Mux) Handle(pattern string, handlers ...interface{}) {
	mx.handle(mALL, pattern, handlers...)
}

// Connect adds a route that matches a CONNECT http method and the `pattern`
// for the `handlers` chain.
func (mx *Mux) Connect(pattern string, handlers ...interface{}) {
	mx.handle(mCONNECT, pattern, handlers...)
}

// Head adds a route that matches a HEAD http method and the `pattern`
// for the `handlers` chain.
func (mx *Mux) Head(pattern string, handlers ...interface{}) {
	mx.handle(mHEAD, pattern, handlers...)
}

// Get adds a route that matches a GET http method and the `pattern`
// for the `handlers` chain.
func (mx *Mux) Get(pattern string, handlers ...interface{}) {
	mx.handle(mGET, pattern, handlers...)
}

// Post adds a route that matches a POST http method and the `pattern`
// for the `handlers` chain.
func (mx *Mux) Post(pattern string, handlers ...interface{}) {
	mx.handle(mPOST, pattern, handlers...)
}

// Put adds a route that matches a PUT http method and the `pattern`
// for the `handlers` chain.
func (mx *Mux) Put(pattern string, handlers ...interface{}) {
	mx.handle(mPUT, pattern, handlers...)
}

// Patch adds a route that matches a PATCH http method and the `pattern`
// for the `handlers` chain.
func (mx *Mux) Patch(pattern string, handlers ...interface{}) {
	mx.handle(mPATCH, pattern, handlers...)
}

// Delete adds a route that matches a DELETE http method and the `pattern`
// for the `handlers` chain.
func (mx *Mux) Delete(pattern string, handlers ...interface{}) {
	mx.handle(mDELETE, pattern, handlers...)
}

// Trace adds a route that matches a TRACE http method and the `pattern`
// for the `handlers` chain.
func (mx *Mux) Trace(pattern string, handlers ...interface{}) {
	mx.handle(mTRACE, pattern, handlers...)
}

// Options adds a route that matches a OPTIONS http method and the `pattern`
// for the `handlers` chain.
func (mx *Mux) Options(pattern string, handlers ...interface{}) {
	mx.handle(mOPTIONS, pattern, handlers...)
}

// NotFound sets a custom http.HandlerFunc for missing routes on the treeRouter.
func (mx *Mux) NotFound(h HandlerFunc) {
	mx.router.notFoundHandler = &h
}

// FileServer conveniently sets up a http.FileServer handler to serve
// static files from a http.FileSystem.
func (mx *Mux) FileServer(path string, root http.FileSystem) {
	fs := http.StripPrefix(path, http.FileServer(root))
	mx.Get(path+"*", func(w http.ResponseWriter, r *http.Request) {
		fs.ServeHTTP(w, r)
	})
}

// handle creates a chi.Handler from a chain of middlewares and an end handler,
// and then registers the route in the router.
func (mx *Mux) handle(method methodTyp, pattern string, handlers ...interface{}) {
	if len(pattern) == 0 || pattern[0] != '/' {
		panic(fmt.Sprintf("pattern must begin with '/' in '%s'", pattern))
	}

	// Build the single mux handler that is a chain of the middleware stack, as
	// defined by calls to Use(), and the tree router (mux) itself. After this point,
	// no other middlewares can be registered on this mux's stack. But you can still
	// use inline middlewares via Group()'s and other routes that only execute after
	// a matched pattern on the treeRouter.
	if !mx.inline && mx.handler == nil {
		mx.handler = chain(mx.middlewares, mx.router)
	}

	// Build endpoint handler with inline middlewares for the route
	var endpoint Handler
	if mx.inline {
		mx.handler = mx.router
		endpoint = chain(mx.middlewares, handlers...)
	} else {
		endpoint = chain([]interface{}{}, handlers...)
	}

	// Set the route for the respective HTTP methods
	for _, mt := range methodMap {
		m := method & mt
		if m > 0 {
			mx.router.routes[m].Insert(pattern, endpoint)
		}
	}
}

// Group creates a new inline-Mux with a fresh middleware stack. It's useful
// for a group of handlers along the same routing path that use the same
// middleware(s). See _examples/ for an example usage.
func (mx *Mux) Group(fn func(r Router)) Router {
	// Similarly as in handle(), we must build the mux handler once further
	// middleware registration isn't allowed for this stack, like now.
	if !mx.inline && mx.handler == nil {
		mx.handler = chain(mx.middlewares, mx.router)
	}

	// Make a new inline mux and run the router functions over it.
	g := &Mux{inline: true, router: mx.router, handler: nil}
	if fn != nil {
		fn(g)
	}
	return g
}

// Route creates a new Mux with a fresh middleware stack and mounts it
// along the `pattern`. This is very simiular to the Group, but attaches
// the group along a new routing path. See _examples/ for example usage.
func (mx *Mux) Route(pattern string, fn func(r Router)) Router {
	subRouter := NewRouter()
	mx.Mount(pattern, subRouter)
	if fn != nil {
		fn(subRouter)
	}
	return subRouter
}

// Mount attaches another mux as a subrouter along a routing path. It's very useful
// to split up a large API as many independent routers and compose them as a single
// service using Mount. See _examples/ for example usage.
func (mx *Mux) Mount(path string, handlers ...interface{}) {
	// Build chain with any inline middlewares and endpoint handler for the subrouter
	h := chain([]interface{}{}, handlers...)

	// Assign sub-Router's with the parent not found handler if not specified.
	for _, hh := range handlers {
		if sr, ok := hh.(*Mux); ok {
			if sr.router.notFoundHandler == nil && mx.router.notFoundHandler != nil {
				sr.NotFound(*mx.router.notFoundHandler)
			}
		}
	}

	// Wrap the sub-router in a handlerFunc to scope the request path for routing.
	subHandler := HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
		rctx := RouteContext(ctx)
		rctx.RoutePath = "/" + rctx.Params.Del("*")
		h.ServeHTTPC(ctx, w, r)
	})

	if path == "" || path[len(path)-1] != '/' {
		mx.Handle(path, subHandler)
		mx.Handle(path+"/", mx.router.NotFoundHandlerFn())
		path += "/"
	}
	mx.Handle(path+"*", subHandler)
}

// ServeHTTP is the single method of the http.Handler interface that makes
// Mux interoperable with the standard library. It uses a sync.Pool to get and
// reuse routing contexts for each request.
func (mx *Mux) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	mx.ServeHTTPC(nil, w, r)
}

// ServeHTTPC is chi's Handler method that adds a context.Context argument to the
// standard ServeHTTP handler function.
func (mx *Mux) ServeHTTPC(ctx context.Context, w http.ResponseWriter, r *http.Request) {
	// Ensure the mux has some routes defined on the mux
	if mx.handler == nil {
		panic("chi: attempting to route to a mux with no handlers.")
	}

	if ctx == nil {
		rctx := mx.pool.Get().(*Context)
		mx.handler.ServeHTTPC(rctx, w, r)
		rctx.reset()
		mx.pool.Put(rctx)
		return
	}

	if rctx, ok := ctx.(*Context); !ok {
		if rctx, ok = ctx.Value(routeCtxKey).(*Context); !ok {
			rctx = mx.pool.Get().(*Context)
			ctx = context.WithValue(ctx, routeCtxKey, rctx)
			mx.handler.ServeHTTPC(ctx, w, r)
			rctx.reset()
			mx.pool.Put(rctx)
			return
		}
	}

	// Serve through mux handler
	mx.handler.ServeHTTPC(ctx, w, r)
}

// A treeRouter manages a radix trie prefix-router for each HTTP method and passes
// each request via its chi.Handler method.
type treeRouter struct {
	// Routing tree by method type
	routes map[methodTyp]*tree

	// Custom route not found handler
	notFoundHandler *HandlerFunc
}

// newTreeRouter creates a new treeRouter object and initializes the trees for
// each http method.
func newTreeRouter() *treeRouter {
	tr := &treeRouter{
		routes:          make(map[methodTyp]*tree, len(methodMap)),
		notFoundHandler: nil,
	}
	for _, v := range methodMap {
		tr.routes[v] = &tree{root: &node{}}
	}
	return tr
}

// NotFoundHandlerFn returns the HandlerFunc setup on the tree.
func (tr treeRouter) NotFoundHandlerFn() HandlerFunc {
	if tr.notFoundHandler != nil {
		return *tr.notFoundHandler
	}
	return HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	})
}

// ServeHTTPC is the main routing method for each request.
func (tr treeRouter) ServeHTTPC(ctx context.Context, w http.ResponseWriter, r *http.Request) {
	// Grab the root context object
	rctx, _ := ctx.(*Context)
	if rctx == nil {
		rctx, _ = ctx.Value(routeCtxKey).(*Context)
		if rctx == nil {
			panic("chi: route context is required.")
		}
	}

	// The request path
	routePath := rctx.RoutePath
	if routePath == "" {
		routePath = r.URL.Path
	}

	// Check if method is supported by chi
	method, ok := methodMap[r.Method]
	if !ok {
		methodNotAllowedHandler(ctx, w, r)
		return
	}

	// Find the handler in the router
	cxh := tr.routes[method].Find(rctx, routePath)

	if cxh == nil {
		tr.NotFoundHandlerFn().ServeHTTPC(ctx, w, r)
		return
	}

	// Serve it
	cxh.ServeHTTPC(ctx, w, r)
}
