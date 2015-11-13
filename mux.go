package chi

import (
	"fmt"
	"net/http"

	"golang.org/x/net/context"
)

var _ Router = &Mux{}

type Mux struct {
	// The middleware stack, supporting..
	// func(http.Handler) http.Handler and func(chi.Handler) chi.Handler
	middlewares []interface{}

	// The radix trie router with URL parameter matching
	router treeRouter

	// The mux handler, chained middleware stack and tree router
	handler Handler

	// Controls the behaviour of middleware chain generation when a mux
	// is registered as an inline group inside another mux.
	inline bool

	// can add rules here for how the mux should work..
	// ie. slashes, case insensitive, notfound handler etc.. like httprouter
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

type ctxKey int

const (
	URLParamsCtxKey ctxKey = iota
	SubRouterCtxKey
	MatchedPathCtxKey
)

func NewMux() *Mux {
	return &Mux{router: newTreeRouter(), handler: nil}
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
			mx.router[m].Insert(pattern, endpoint)
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

	// Route the subroutes through a wildcard url param
	subRouter := HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
		path := URLParams(ctx)["*"]
		ctx = context.WithValue(ctx, SubRouterCtxKey, "/"+path)
		h.ServeHTTPC(ctx, w, r)
	})

	if path == "" || path[len(path)-1] != '/' {
		mx.Handle(path, subRouter)
		mx.Handle(path+"/", http.NotFound) // TODO: which not-found handler..?
		path += "/"
	}
	mx.Handle(path+"*", subRouter)
}

func (mx *Mux) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	mx.ServeHTTPC(context.Background(), w, r)
}

func (mx *Mux) ServeHTTPC(ctx context.Context, w http.ResponseWriter, r *http.Request) {
	mx.handler.ServeHTTPC(ctx, w, r)
}

type treeRouter map[methodTyp]*tree

func newTreeRouter() treeRouter {
	tr := make(map[methodTyp]*tree, len(methodMap))
	for _, v := range methodMap {
		tr[v] = &tree{root: &node{}}
	}
	return treeRouter(tr)
}

func (tr treeRouter) ServeHTTPC(ctx context.Context, w http.ResponseWriter, r *http.Request) {
	// Allocate a new url params map at the start of each request.
	params, ok := ctx.Value(URLParamsCtxKey).(map[string]string)
	if !ok || params == nil {
		params = make(map[string]string, 0)
		ctx = context.WithValue(ctx, URLParamsCtxKey, params)
	}

	// The request path
	routePath, ok := ctx.Value(SubRouterCtxKey).(string)
	if ok {
		delete(params, "*")
	} else {
		routePath = r.URL.Path
	}

	// Find the handler in the router
	cxh, path := tr[methodMap[r.Method]].Find(routePath, params)
	if cxh == nil {
		w.WriteHeader(404)
		w.Write([]byte(http.StatusText(404)))
		return
	}

	ctx = context.WithValue(ctx, MatchedPathCtxKey, path)

	// Serve it
	cxh.ServeHTTPC(ctx, w, r)
}
