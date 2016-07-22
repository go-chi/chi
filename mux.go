package chi

import (
	"fmt"
	"net/http"
	"sync"
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
	// The radix trie router
	tree *node

	// The middleware stack
	middlewares []func(http.Handler) http.Handler

	// The computed mux handler made of the chained middleware stack and
	// the tree router
	handler http.Handler

	// Controls the behaviour of middleware chain generation when a mux
	// is registered as an inline group inside another mux.
	inline bool

	// Routing context pool
	pool sync.Pool

	// Custom route not found handler
	notFoundHandler http.HandlerFunc
}

// NewMux returns a new Mux object with an optional parent context.
func NewMux() *Mux {
	mux := &Mux{tree: &node{}}
	mux.pool.New = func() interface{} {
		return NewRouteContext()
	}
	return mux
}

// ServeHTTP is the single method of the http.Handler interface that makes
// Mux interoperable with the standard library. It uses a sync.Pool to get and
// reuse routing contexts for each request.
func (mx *Mux) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Ensure the mux has some routes defined on the mux
	if mx.handler == nil {
		panic("chi: attempting to route to a mux with no handlers.")
	}

	rctx, _ := r.Context().Value(RouteCtxKey).(*Context)
	if rctx != nil {
		mx.handler.ServeHTTP(w, r)
		return
	}

	// Fetch a RouteContext object from the sync pool, and call the computed
	// mx.handler that is comprised of mx.middlewares + mx.routeHTTP.
	// Once the request is finsihed, reset the routing context and put it back
	// into the pool for reuse from another request.
	rctx = mx.pool.Get().(*Context)
	rctx.reset()
	mx.handler.ServeHTTP(w, r.WithContext(rctx))
	mx.pool.Put(rctx)
}

// Use appends a middleware handler to the Mux middleware stack.
func (mx *Mux) Use(middlewares ...func(http.Handler) http.Handler) {
	mx.middlewares = append(mx.middlewares, middlewares...)
}

// Handle adds a route for all http methods that match the `pattern`
// for the `handlers` chain.
func (mx *Mux) Handle(pattern string, handler http.Handler) {
	mx.handle(mALL, pattern, handler)
}

func (mx *Mux) HandleFunc(pattern string, handlerFn http.HandlerFunc) {
	mx.handle(mALL, pattern, handlerFn)
}

// Connect adds a route that matches a CONNECT http method and the `pattern`
// for the `handlers` chain.
func (mx *Mux) Connect(pattern string, handlerFn http.HandlerFunc) {
	mx.handle(mCONNECT, pattern, handlerFn)
}

// Head adds a route that matches a HEAD http method and the `pattern`
// for the `handlers` chain.
func (mx *Mux) Head(pattern string, handlerFn http.HandlerFunc) {
	mx.handle(mHEAD, pattern, handlerFn)
}

// Get adds a route that matches a GET http method and the `pattern`
// for the `handlers` chain.
func (mx *Mux) Get(pattern string, handlerFn http.HandlerFunc) {
	mx.handle(mGET, pattern, handlerFn)
}

// Post adds a route that matches a POST http method and the `pattern`
// for the `handlers` chain.
func (mx *Mux) Post(pattern string, handlerFn http.HandlerFunc) {
	mx.handle(mPOST, pattern, handlerFn)
}

// Put adds a route that matches a PUT http method and the `pattern`
// for the `handlers` chain.
func (mx *Mux) Put(pattern string, handlerFn http.HandlerFunc) {
	mx.handle(mPUT, pattern, handlerFn)
}

// Patch adds a route that matches a PATCH http method and the `pattern`
// for the `handlers` chain.
func (mx *Mux) Patch(pattern string, handlerFn http.HandlerFunc) {
	mx.handle(mPATCH, pattern, handlerFn)
}

// Delete adds a route that matches a DELETE http method and the `pattern`
// for the `handlers` chain.
func (mx *Mux) Delete(pattern string, handlerFn http.HandlerFunc) {
	mx.handle(mDELETE, pattern, handlerFn)
}

// Trace adds a route that matches a TRACE http method and the `pattern`
// for the `handlers` chain.
func (mx *Mux) Trace(pattern string, handlerFn http.HandlerFunc) {
	mx.handle(mTRACE, pattern, handlerFn)
}

// Options adds a route that matches a OPTIONS http method and the `pattern`
// for the `handlers` chain.
func (mx *Mux) Options(pattern string, handlerFn http.HandlerFunc) {
	mx.handle(mOPTIONS, pattern, handlerFn)
}

// NotFound sets a custom http.HandlerFunc for missing routes on the treeRouter.
func (mx *Mux) NotFound(handlerFn http.HandlerFunc) {
	mx.notFoundHandler = handlerFn
}

// Group creates a new inline-Mux with a fresh middleware stack. It's useful
// for a group of handlers along the same routing path that use the same
// middleware(s). See _examples/ for an example usage.
func (mx *Mux) Group(fn func(r Router)) Router {
	// Similarly as in handle(), we must build the mux handler once further
	// middleware registration isn't allowed for this stack, like now.
	if !mx.inline && mx.handler == nil {
		mx.buildRouteHandler()
	}

	// Make a new inline mux and run the router functions over it.
	g := &Mux{inline: true, tree: mx.tree}
	if fn != nil {
		fn(g)
	}
	return g
}

// Route creates a new Mux with a fresh middleware stack and mounts it
// along the `pattern` as a subrouter. This is very similar to Group, but attaches
// the group along a new routing path. See _examples/ for example usage.
func (mx *Mux) Route(pattern string, fn func(r Router)) Router {
	subRouter := NewRouter()
	if fn != nil {
		fn(subRouter)
	}
	mx.Mount(pattern, subRouter)
	return subRouter
}

// Mount attaches another chi Router as a subrouter along a routing path. It's very
// useful to split up a large API as many independent routers and compose them as
// a single service using Mount. See _examples/ for example usage.
func (mx *Mux) Mount(pattern string, handler http.Handler) {
	// Assign sub-Router's with the parent not found handler if not specified.
	// TODO: is there a better way to get the mux ?
	sr, ok := handler.(*Mux)
	if ok && sr.notFoundHandler == nil && mx.notFoundHandler != nil {
		sr.NotFound(mx.notFoundHandler)
	}

	// Wrap the sub-router in a handlerFunc to scope the request path for routing.
	subHandler := func(w http.ResponseWriter, r *http.Request) {
		rctx := RouteContext(r.Context())
		rctx.RoutePath = "/" + rctx.Params.Del("*")
		handler.ServeHTTP(w, r)
	}

	if pattern == "" || pattern[len(pattern)-1] != '/' {
		mx.HandleFunc(pattern, subHandler)
		mx.HandleFunc(pattern+"/", mx.notFoundHandler)
		pattern += "/"
	}
	mx.HandleFunc(pattern+"*", subHandler)
}

// FileServer conveniently sets up a http.FileServer handler to serve
// static files from a http.FileSystem.
func (mx *Mux) FileServer(path string, root http.FileSystem) {
	fs := http.StripPrefix(path, http.FileServer(root))
	mx.Get(path+"*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fs.ServeHTTP(w, r)
	}))
}

func (mx *Mux) buildRouteHandler() {
	mx.handler = Chain(mx.middlewares, http.HandlerFunc(mx.routeHTTP))
}

// handle creates a chi.Handler from a chain of middlewares and an end handler,
// and then registers the route in the router.
// TODO: should we rename this method to register() ?
func (mx *Mux) handle(method methodTyp, pattern string, handler http.Handler) {
	if len(pattern) == 0 || pattern[0] != '/' {
		panic(fmt.Sprintf("chi: routing pattern must begin with '/' in '%s'", pattern))
	}

	// Build the single mux handler that is a chain of the middleware stack, as
	// defined by calls to Use(), and the tree router (mux) itself. After this point,
	// no other middlewares can be registered on this mux's stack. But you can still
	// use inline middlewares via Group()'s and other routes that only execute after
	// a matched pattern on the treeRouter.
	if !mx.inline && mx.handler == nil {
		mx.buildRouteHandler()
	}

	// Build endpoint handler with inline middlewares for the route
	var endpoint http.Handler
	if mx.inline {
		mx.handler = http.HandlerFunc(mx.routeHTTP)
		endpoint = Chain(mx.middlewares, handler)
	} else {
		endpoint = handler
	}

	// Add the endpoint to the tree
	mx.tree.InsertRoute(method, pattern, endpoint)
}

func (mx *Mux) routeHTTP(w http.ResponseWriter, r *http.Request) {
	// Grab the root context object
	ctx := r.Context()
	rctx, _ := ctx.(*Context)
	if rctx == nil {
		rctx = ctx.Value(RouteCtxKey).(*Context)
	}

	// The request routing path
	routePath := rctx.RoutePath
	if routePath == "" {
		routePath = r.URL.Path
	}

	// Check if method is supported by chi
	method, ok := methodMap[r.Method]
	if !ok {
		methodNotAllowedHandler(w, r)
		return
	}

	// Find the route
	hs := mx.tree.FindRoute(rctx, routePath)

	if hs == nil {
		if mx.notFoundHandler != nil {
			mx.notFoundHandler(w, r)
		} else {
			http.NotFound(w, r)
		}
		return
	}

	h, ok := hs[method]
	if !ok {
		methodNotAllowedHandler(w, r)
		return
	}

	// Serve it up
	h.ServeHTTP(w, r)
}
