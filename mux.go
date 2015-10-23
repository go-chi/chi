package chi

import (
	"net/http"

	"golang.org/x/net/context"
)

var _ Router = &Mux{}

type Mux struct {
	middlewares []interface{}
	routes      map[methodTyp]*tree

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

func (m methodTyp) String() string {
	for k, v := range methodMap {
		if v == m {
			return k
		}
	}
	return ""
}

type ctxKey int

const (
	urlParamsCtxKey ctxKey = iota
	subRouterCtxKey
)

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
	// Build handler from middleware stack, inline middlewares and handler
	h := chain(mx.middlewares, handlers...)

	if pattern[0] != '/' {
		panic("pattern must begin with a /") // TODO: is goji like this too?
	}

	if mx.routes == nil {
		mx.routes = make(map[methodTyp]*tree, len(methodMap))
		for _, v := range methodMap {
			mx.routes[v] = &tree{root: &node{}}
		}
	}

	for _, mt := range methodMap {
		m := method & mt
		if m > 0 {
			routes := mx.routes[m]

			err := routes.Insert(pattern, h)
			_ = err // ...?
		}
	}
}

func (mx *Mux) Group(fn func(r Router)) Router {
	mw := make([]interface{}, len(mx.middlewares))
	copy(mw, mx.middlewares)

	g := &Mux{middlewares: mw, routes: mx.routes}
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
	h := chain([]interface{}{}, handlers...)

	subRouter := HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
		path := URLParams(ctx)["*"]
		ctx = context.WithValue(ctx, subRouterCtxKey, "/"+path)
		h.ServeHTTPC(ctx, w, r)
	})

	if path == "/" {
		path = ""
	}

	mx.Handle(path, subRouter)
	if path != "" {
		mx.Handle(path+"/", http.NotFound) // TODO: which not-found handler..?
	}
	mx.Handle(path+"/*", subRouter)
}

func (mx *Mux) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	mx.ServeHTTPC(context.Background(), w, r)
}

func (mx *Mux) ServeHTTPC(ctx context.Context, w http.ResponseWriter, r *http.Request) {
	var cxh Handler
	var err error

	params, ok := ctx.Value(urlParamsCtxKey).(map[string]string)
	if !ok || params == nil {
		params = make(map[string]string, 0)
		ctx = context.WithValue(ctx, urlParamsCtxKey, params)
	}

	path := r.URL.Path
	if routePath, ok := ctx.Value(subRouterCtxKey).(string); ok {
		path = routePath
		ctx = context.WithValue(ctx, subRouterCtxKey, nil) // unset the routePath
		delete(params, "*")
	}

	routes := mx.routes[methodMap[r.Method]]
	cxh, err = routes.Find(path, params)
	_ = err // ..

	if cxh == nil {
		http.NotFound(w, r)
		return
	}

	// Serve it
	cxh.ServeHTTPC(ctx, w, r)
}
