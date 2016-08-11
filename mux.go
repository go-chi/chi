package chi

import (
	"fmt"
	"net/http"
	"strings"
	"sync"
)

var _ Router = &Mux{}

// Mux is a simple HTTP route multiplexer that parses a request path,
// records any URL params, and executes an end handler. It implements
// the http.Handler interface and is friendly with the standard library.
//
// Mux is designed to be fast, minimal and offer a powerful API for building
// modular and composable HTTP services with a large set of handlers. It's
// particularly useful for writing large REST API services that break a handler
// into many smaller parts composed of middlewares and end handlers.
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

// NewMux returns a newly initialized Mux object that implements the Router
// interface.
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

	// Check if a routing context already exists from a parent router.
	rctx, _ := r.Context().Value(RouteCtxKey).(*Context)
	if rctx != nil {
		mx.handler.ServeHTTP(w, r)
		return
	}

	// Fetch a RouteContext object from the sync pool, and call the computed
	// mx.handler that is comprised of mx.middlewares + mx.routeHTTP.
	// Once the request is finished, reset the routing context and put it back
	// into the pool for reuse from another request.
	rctx = mx.pool.Get().(*Context)
	rctx.reset()
	rctx.parent = r.Context()
	mx.handler.ServeHTTP(w, r.WithContext(rctx))
	mx.pool.Put(rctx)
}

// Use appends a middleware handler to the Mux middleware stack.
//
// The middleware stack for any Mux will execute before searching for a matching
// route to a specific handler, which provides opportunity to respond early,
// change the course of the request execution, or set request-scoped values for
// the next http.Handler.
func (mx *Mux) Use(middlewares ...func(http.Handler) http.Handler) {
	if mx.handler != nil {
		panic("chi: all middlewares must be defined before routes on a mux")
	}
	mx.middlewares = append(mx.middlewares, middlewares...)
}

// Handle adds the route `pattern` that matches any http method to
// execute the `handler` http.Handler.
func (mx *Mux) Handle(pattern string, handler http.Handler) {
	mx.handle(mALL, pattern, handler)
}

// HandleFunc adds the route `pattern` that matches any http method to
// execute the `handlerFn` http.HandlerFunc.
func (mx *Mux) HandleFunc(pattern string, handlerFn http.HandlerFunc) {
	mx.handle(mALL, pattern, handlerFn)
}

// Connect adds the route `pattern` that matches a CONNECT http method to
// execute the `handlerFn` http.HandlerFunc.
func (mx *Mux) Connect(pattern string, handlerFn http.HandlerFunc) {
	mx.handle(mCONNECT, pattern, handlerFn)
}

// Head adds the route `pattern` that matches a HEAD http method to
// execute the `handlerFn` http.HandlerFunc.
func (mx *Mux) Head(pattern string, handlerFn http.HandlerFunc) {
	mx.handle(mHEAD, pattern, handlerFn)
}

// Get adds the route `pattern` that matches a GET http method to
// execute the `handlerFn` http.HandlerFunc.
func (mx *Mux) Get(pattern string, handlerFn http.HandlerFunc) {
	mx.handle(mGET, pattern, handlerFn)
}

// Post adds the route `pattern` that matches a POST http method to
// execute the `handlerFn` http.HandlerFunc.
func (mx *Mux) Post(pattern string, handlerFn http.HandlerFunc) {
	mx.handle(mPOST, pattern, handlerFn)
}

// Put adds the route `pattern` that matches a PUT http method to
// execute the `handlerFn` http.HandlerFunc.
func (mx *Mux) Put(pattern string, handlerFn http.HandlerFunc) {
	mx.handle(mPUT, pattern, handlerFn)
}

// Patch adds the route `pattern` that matches a PATCH http method to
// execute the `handlerFn` http.HandlerFunc.
func (mx *Mux) Patch(pattern string, handlerFn http.HandlerFunc) {
	mx.handle(mPATCH, pattern, handlerFn)
}

// Delete adds the route `pattern` that matches a DELETE http method to
// execute the `handlerFn` http.HandlerFunc.
func (mx *Mux) Delete(pattern string, handlerFn http.HandlerFunc) {
	mx.handle(mDELETE, pattern, handlerFn)
}

// Trace adds the route `pattern` that matches a TRACE http method to
// execute the `handlerFn` http.HandlerFunc.
func (mx *Mux) Trace(pattern string, handlerFn http.HandlerFunc) {
	mx.handle(mTRACE, pattern, handlerFn)
}

// Options adds the route `pattern` that matches a OPTIONS http method to
// execute the `handlerFn` http.HandlerFunc.
func (mx *Mux) Options(pattern string, handlerFn http.HandlerFunc) {
	mx.handle(mOPTIONS, pattern, handlerFn)
}

// NotFound sets a custom http.HandlerFunc for routing paths that could
// not be found. The default 404 handler is `http.NotFound`.
func (mx *Mux) NotFound(handlerFn http.HandlerFunc) {
	mx.notFoundHandler = handlerFn
}

// Group creates a new inline-Mux with a fresh middleware stack. It's useful
// for a group of handlers along the same routing path that use an additional
// set of middlewares. See _examples/.
func (mx *Mux) Group(fn func(r Router)) Router {
	// Similarly as in handle(), we must build the mux handler once further
	// middleware registration isn't allowed for this stack, like now.
	if !mx.inline && mx.handler == nil {
		mx.buildRouteHandler()
	}

	// Copy middlewares for nested Group()'s
	var mw Middlewares
	if mx.inline {
		mw = make(Middlewares, len(mx.middlewares))
		copy(mw, mx.middlewares)
	}

	// Make a new inline mux and run the router functions over it.
	g := &Mux{inline: true, tree: mx.tree, middlewares: mw}
	if fn != nil {
		fn(g)
	}
	return g
}

// Route creates a new Mux with a fresh middleware stack and mounts it
// along the `pattern` as a subrouter. Effectively, this is a short-hand
// call to Mount. See _examples/.
func (mx *Mux) Route(pattern string, fn func(r Router)) Router {
	subRouter := NewRouter()
	if fn != nil {
		fn(subRouter)
	}
	mx.Mount(pattern, subRouter)
	return subRouter
}

// Mount attaches another http.Handler or chi Router as a subrouter along a routing
// path. It's very useful to split up a large API as many independent routers and
// compose them as a single service using Mount. See _examples/.
//
// Note that Mount() simply sets a wildcard along the `pattern` that will continue
// routing at the `handler`, which in most cases is another chi.Router. As a result,
// if you define two Mount() routes on the exact same pattern the mount will panic.
func (mx *Mux) Mount(pattern string, handler http.Handler) {
	// Provide runtime safety for ensuring a pattern isn't mounted on an existing
	// routing pattern.
	if mx.tree.findPattern(pattern+"*") != nil || mx.tree.findPattern(pattern+"/*") != nil {
		panic(fmt.Sprintf("chi: attempting to Mount() a handler on an existing path, '%s'", pattern))
	}

	// Assign sub-Router's with the parent not found handler if not specified.
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
		mx.HandleFunc(pattern+"/", mx.NotFoundHandler())
		pattern += "/"
	}
	mx.HandleFunc(pattern+"*", subHandler)
}

// FileServer conveniently sets up a http.FileServer handler to serve
// static files from a http.FileSystem.
func (mx *Mux) FileServer(path string, root http.FileSystem) {
	if strings.ContainsAny(path, ":*") {
		panic("chi: FileServer does not permit URL parameters.")
	}

	fs := http.StripPrefix(path, http.FileServer(root))

	if path != "/" && path[len(path)-1] != '/' {
		mx.Get(path, http.RedirectHandler(path+"/", 301).ServeHTTP)
		path += "/"
	}
	path += "*"

	mx.Get(path, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fs.ServeHTTP(w, r)
	}))
}

// NotFoundHandler returns the default Mux 404 responder whenever a route
// cannot be found.
func (mx *Mux) NotFoundHandler() http.HandlerFunc {
	if mx.notFoundHandler != nil {
		return mx.notFoundHandler
	} else {
		return http.NotFound
	}
}

// buildRouteHandler builds the single mux handler that is a chain of the middleware
// stack, as defined by calls to Use(), and the tree router (Mux) itself. After this
// point, no other middlewares can be registered on this Mux's stack. But you can still
// compose additional middlewares via Group()'s or using a chained middleware handler.
func (mx *Mux) buildRouteHandler() {
	mx.handler = Chain(mx.middlewares, http.HandlerFunc(mx.routeHTTP))
}

// handle registers a http.Handler in the routing tree for a particular http method
// and routing pattern.
func (mx *Mux) handle(method methodTyp, pattern string, handler http.Handler) {
	if len(pattern) == 0 || pattern[0] != '/' {
		panic(fmt.Sprintf("chi: routing pattern must begin with '/' in '%s'", pattern))
	}

	// Build the final routing handler for this Mux.
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

// routeHTTP routes a http.Request through the Mux routing tree to serve
// the matching handler for a particular http method.
func (mx *Mux) routeHTTP(w http.ResponseWriter, r *http.Request) {
	// Grab the route context object
	rctx := r.Context().Value(RouteCtxKey).(*Context)

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
		mx.NotFoundHandler().ServeHTTP(w, r)
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
