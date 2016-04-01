package chi

import (
	"fmt"
	"net/http"
	"sync"

	"golang.org/x/net/context"
)

var _ Router = &Mux{}

type Mux struct {
	// The middleware stack, supporting..
	// func(http.Handler) http.Handler and func(chi.Handler) chi.Handler
	middlewares []interface{}

	// The radix trie router with URL parameter matching
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

func NewMux() *Mux {
	mux := &Mux{router: newTreeRouter(), handler: nil}
	mux.pool.New = func() interface{} {
		return newContext()
	}
	return mux
}

// Append to the middleware stack
func (mx *Mux) Use(mws ...interface{}) {
	for _, mw := range mws {
		mx.middlewares = append(mx.middlewares, assertMiddleware(mw))
	}
}

func (mx *Mux) Handle(pattern string, handlers ...interface{}) {
	mx.handle(mALL, pattern, handlers...)
}

func (mx *Mux) Connect(pattern string, handlers ...interface{}) {
	mx.handle(mCONNECT, pattern, handlers...)
}

func (mx *Mux) Head(pattern string, handlers ...interface{}) {
	mx.handle(mHEAD, pattern, handlers...)
}

func (mx *Mux) Get(pattern string, handlers ...interface{}) {
	mx.handle(mGET, pattern, handlers...)
}

func (mx *Mux) Post(pattern string, handlers ...interface{}) {
	mx.handle(mPOST, pattern, handlers...)
}

func (mx *Mux) Put(pattern string, handlers ...interface{}) {
	mx.handle(mPUT, pattern, handlers...)
}

func (mx *Mux) Patch(pattern string, handlers ...interface{}) {
	mx.handle(mPATCH, pattern, handlers...)
}

func (mx *Mux) Delete(pattern string, handlers ...interface{}) {
	mx.handle(mDELETE, pattern, handlers...)
}

func (mx *Mux) Trace(pattern string, handlers ...interface{}) {
	mx.handle(mTRACE, pattern, handlers...)
}

func (mx *Mux) Options(pattern string, handlers ...interface{}) {
	mx.handle(mOPTIONS, pattern, handlers...)
}

// NotFound sets a custom handler for the case when no routes match
func (mx *Mux) NotFound(h HandlerFunc) {
	mx.router.notFoundHandler = &h
}

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

func (mx *Mux) Route(pattern string, fn func(r Router)) Router {
	subRouter := NewRouter()
	mx.Mount(pattern, subRouter)
	if fn != nil {
		fn(subRouter)
	}
	return subRouter
}

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
		rctx := RootContext(ctx)
		rctx.routePath = "/" + rctx.delParam("*")
		h.ServeHTTPC(ctx, w, r)
	})

	if path == "" || path[len(path)-1] != '/' {
		mx.Handle(path, subHandler)
		mx.Handle(path+"/", mx.router.NotFoundHandlerFn())
		path += "/"
	}
	mx.Handle(path+"*", subHandler)
}

// Serve static files under a path
func (mx *Mux) FileServer(path string, root http.FileSystem) {
	fs := http.StripPrefix(path, http.FileServer(root))
	mx.Get(path+"*", func(w http.ResponseWriter, r *http.Request) {
		fs.ServeHTTP(w, r)
	})
}

func (mx *Mux) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	ctx := mx.pool.Get().(*Context)
	mx.ServeHTTPC(ctx, w, r)
	ctx.reset()
	mx.pool.Put(ctx)
}

func (mx *Mux) ServeHTTPC(ctx context.Context, w http.ResponseWriter, r *http.Request) {
	mx.handler.ServeHTTPC(ctx, w, r)
}

type treeRouter struct {
	// Routing tree by method type
	routes map[methodTyp]*tree

	// Custom route not found handler
	notFoundHandler *HandlerFunc
}

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

func (tr treeRouter) NotFoundHandlerFn() HandlerFunc {
	if tr.notFoundHandler != nil {
		return *tr.notFoundHandler
	}
	return HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	})
}

func (tr treeRouter) ServeHTTPC(ctx context.Context, w http.ResponseWriter, r *http.Request) {
	// Grab the root context object
	rctx, _ := ctx.(*Context)
	if rctx == nil {
		rctx = ctx.Value(rootCtxKey).(*Context)
	}

	// The request path
	routePath := rctx.routePath
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
