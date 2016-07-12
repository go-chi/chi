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
	router *tree

	// The middleware stack
	middlewares []func(http.Handler) http.Handler

	// The computed mux handler made of the chained middleware stack and
	// the tree router
	handler http.Handler

	// A reference to the parent mux used by subrouters when mounting
	// to a parent mux
	parent *Mux

	// The mounting pattern used by subrouters used to build subsequent
	// routes as other routers mount together
	mountPattern string

	// Controls the behaviour of middleware chain generation when a mux
	// is registered as an inline group inside another mux
	inline bool

	// Routing context pool
	pool sync.Pool

	// Custom route not found handler
	notFoundHandler http.HandlerFunc
}

// NewMux returns a new Mux object with an optional parent context.
func NewMux() *Mux {
	mux := &Mux{
		router:          &tree{root: &node{}},
		notFoundHandler: http.NotFound,
	}
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

	// Fetch a RouteContext object from the sync pool, and call the computed
	// mx.handler that is comprised of mx.middlewares + mx.routeHTTP.
	// Once the request is finsihed, reset the routing context and put it back
	// into the pool for reuse from another request.
	rctx := mx.pool.Get().(*Context)
	r = r.WithContext(rctx)
	mx.handler.ServeHTTP(w, r)
	rctx.reset()
	mx.pool.Put(rctx)
}

// Use appends a middleware handler to the Mux middleware stack.
func (mx *Mux) Use(middlewares ...func(http.Handler) http.Handler) {
	// mx.middlewares = append(mx.middlewares, middlewares...)
	mx.AppendMiddleware(middlewares...)
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
	// Similarly as in handle(), we must build the final mux handler from the tree
	// and the middleware stack. Further middleware additions will be ignored,
	// after this point.
	if !mx.inline && mx.handler == nil {
		// mx.handler = chain(mx.middlewares, http.HandlerFunc(mx.routeHTTP))
		mx.buildRouteHandler(false)
	}

	// Make a new inline mux and run the router functions over it.
	g := &Mux{inline: true, router: mx.router}
	if fn != nil {
		fn(g)
	}
	return g
}

// Route creates a new Mux with a fresh middleware stack and mounts it
// along the `pattern` as a subrouter. This is very similar to Group, but attaches
// the group along a new routing path. See _examples/ for example usage.
func (mx *Mux) Route(pattern string, fn func(r Router)) Router {
	subrouter := NewRouter()
	if fn != nil {
		fn(subrouter)
	}
	mx.Mount(pattern, subrouter)
	return subrouter
}

// Mount attaches another chi Router as a subrouter along a routing path. It's very
// useful to split up a large API as many independent routers and compose them as
// a single service using Mount. See _examples/ for example usage.
func (mx *Mux) Mount(pattern string, subrouter Router) {

	// TODO: .. is there a better way..?
	smx := subrouter.GetMux()

	// TODO: change mx.parent to type Router

	// TODO: switch methods to strings ... okay...

	// TODO: add Router method Handle(method, pattern, handler)

	// XXX: FINALLY .... how do we set the damn parent....? and mountPattern ...?
	// XXX: how do we get the parent and mountPattern ...?

	// TODO: Routes() will let us walk a router..

	// IDEA: is it possible to set the parent Mux, and mountingPattern in the actual
	// tree, and get it back from walking...? or get the Mux from walking..?

	// TODO XXX XXX XXX ... is there a different way we can solve this....?
	// instead of having to set any parent...?
	// ie.. like in the tree...?

	smx.parent = mx
	smx.mountPattern = pattern

	rt := mx
	if rt.parent != nil {
		rt = mx.parent
	}

	if mx.mountPattern != "/" {
		pattern = mx.mountPattern + pattern
	}

	// TODO: can we join the routers better somehow...? the actual trees..?

	// Inserting the routes from the subrouter onto the root router.
	smx.router.Walk(func(route string, handlers methodHandlers) bool {
		if route == "/" {
			route = pattern
		} else if pattern[len(pattern)-1] == '/' && route[0] == '/' {
			route = pattern + route[1:]
		} else if pattern != "/" {
			route = pattern + route
		}

		for m, h := range handlers {
			rt.handle(m, route, chain(smx.middlewares, h))
		}

		return false
	})
}

func (mx *Mux) GetMux() *Mux {
	return mx
}

// FileServer conveniently sets up a http.FileServer handler to serve
// static files from a http.FileSystem.
func (mx *Mux) FileServer(path string, root http.FileSystem) {
	fs := http.StripPrefix(path, http.FileServer(root))
	mx.Get(path+"*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fs.ServeHTTP(w, r)
	}))
}

func (mx *Mux) PrependMiddleware(middlewares ...func(http.Handler) http.Handler) {
	mx.middlewares = append(middlewares, mx.middlewares...)
}

func (mx *Mux) AppendMiddleware(middlewares ...func(http.Handler) http.Handler) {
	mx.middlewares = append(mx.middlewares, middlewares...)
}

func (mx *Mux) buildRouteHandler(update bool) {
	if mx.handler == nil || update {
		mx.handler = chain(mx.middlewares, http.HandlerFunc(mx.routeHTTP))
	}
}

// TODO: should we rename this method to register() ?

// handle creates a chi.Handler from a chain of middlewares and an end handler,
// and then registers the route in the router.
func (mx *Mux) handle(method methodTyp, pattern string, handler http.Handler) {
	if len(pattern) == 0 || pattern[0] != '/' {
		panic(fmt.Sprintf("chi: routing pattern must begin with '/' in '%s'", pattern))
	}

	// TOOD: add a validation method to check the route and that params
	// dont conflict.

	// Build the single mux handler that is a chain of the middleware stack, as
	// defined by calls to Use(), and the tree router (mux) itself. After this point,
	// no other middlewares can be registered on this mux's stack. But you can still
	// use inline middlewares via Group()'s and other routes that only execute after
	// a matched pattern on the treeRouter.
	if !mx.inline && mx.handler == nil {
		mx.buildRouteHandler(false)
	}

	// For an inline mux, build the end handler comprised of the middlewares
	if mx.inline {
		handler = chain(mx.middlewares, handler)
	}

	// Add the endpoint to the tree
	mx.router.Insert(method, pattern, handler)
}

func (mx *Mux) routeHTTP(w http.ResponseWriter, r *http.Request) {
	// Grab the root context object
	ctx := r.Context()
	rctx, _ := ctx.(*Context)
	if rctx == nil {
		rctx = ctx.Value(RouteCtxKey).(*Context)
	}

	// The request path
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
	// TODO: any point in giving the method..? maybe later..
	// TODO: if we switch method to string.. then, we can simplify this code..
	hs := mx.router.Find(rctx, method, routePath)

	if hs == nil {
		mx.notFoundHandler(w, r)
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
