package chi

import (
	"fmt"
	"log"
	"net/http"

	"golang.org/x/net/context"
)

type Mux struct {
	mwStack []interface{}
	routes  map[methodTyp]*tree

	// can add rules here for how the mux should work..
	// ie. slashes, notfound handler etc.. like httprouter
}

type methodTyp int

// is there anything to this order.......?
const (
	// just make mALL as 1 ..? and 0 as mUNKNOWN

	mCONNECT methodTyp = 1 << iota // flag?? ..
	mDELETE
	mGET
	mHEAD
	mOPTIONS
	mPATCH
	mPOST
	mPUT
	mTRACE
	// We only natively support the methods above, but we pass through other
	// methods. This constant pretty much only exists for the sake of mALL.
	mIDK

	mALL methodTyp = mCONNECT | mDELETE | mGET | mHEAD | mOPTIONS | mPATCH |
		mPOST | mPUT | mTRACE | mIDK
)

// [...]string{ ... } ? with .String() on `method` type..
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
	urlParamsCtxKey ctxKey = 0
)

func (mx *Mux) Use(mw interface{}) {
	switch t := mw.(type) {
	default:
		panic(fmt.Sprintf("chi: unsupported middleware signature: %T", t))
	case func(http.Handler) http.Handler:
	case func(Handler) Handler:
	}
	mx.mwStack = append(mx.mwStack, mw)
}

func (mx *Mux) Handle(pattern string, handler interface{}) {
	mx.handle(mALL, pattern, handler)
}

func (mx *Mux) Connect(pattern string, handler interface{}) {
	mx.handle(mCONNECT, pattern, handler)
}

func (mx *Mux) Head(pattern string, handler interface{}) {
	mx.handle(mHEAD, pattern, handler)
}

func (mx *Mux) Get(pattern string, handler interface{}) {
	mx.handle(mGET, pattern, handler)
}

func (mx *Mux) Post(pattern string, handler interface{}) {
	mx.handle(mPOST, pattern, handler)
}

func (mx *Mux) Put(pattern string, handler interface{}) {
	mx.handle(mPUT, pattern, handler)
}

func (mx *Mux) Patch(pattern string, handler interface{}) {
	mx.handle(mPATCH, pattern, handler)
}

func (mx *Mux) Delete(pattern string, handler interface{}) {
	mx.handle(mDELETE, pattern, handler)
}

func (mx *Mux) Trace(pattern string, handler interface{}) {
	mx.handle(mTRACE, pattern, handler)
}

func (mx *Mux) Options(pattern string, handler interface{}) {
	mx.handle(mOPTIONS, pattern, handler)
}

// ..?
// func (m *Mux) XHandle(pattern string, handler Handler) {}
// func (m *Mux) HandleFunc(pattern string, handler func(http.ResponseWriter, *http.Request)) {}
// func (m *Mux) XHandleFunc(pattern string, handler func(context.Context, http.ResponseWriter, *http.Request)) {}

// handle(), handleAny()  ....?
func (mx *Mux) handle(method methodTyp, pattern string, handler interface{}) {
	var cxh Handler

	switch t := handler.(type) {
	default:
		panic(fmt.Sprintf("chi: unsupported handler signature: %T", t))
		// case http.Handler:
		// TODO: accept http.Handler too .. will have to get wrapped..
	case Handler:
		cxh = t
	case func(context.Context, http.ResponseWriter, *http.Request):
		cxh = HandlerFunc(t)
	case func(http.ResponseWriter, *http.Request):
		cxh = HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
			t(w, r)
		})
	}

	// TODO: where does this middleware stack chain belong..?
	// not here..
	// Build handler with middleware chain
	mws := mx.mwStack
	h := mwrap(mws[len(mws)-1])(cxh)
	for i := len(mws) - 2; i >= 0; i-- {
		f := mwrap(mws[i])
		h = f(h)
	}

	// ^^TODO^^ - write it for a single handler, and wrap the handlers
	// at a higher level on the Router level.. the Mux is low-level..
	// we can make CMux{} if we want.. for static typed Ctx based mux.. etc.

	//----------------

	if pattern[0] != '/' {
		panic("pattern must begin with a /") // TODO: is goji like this too?
	}

	// where can we put this...?
	if mx.routes == nil {
		mx.routes = make(map[methodTyp]*tree, len(methodMap))
		for _, v := range methodMap {
			mx.routes[v] = &tree{root: &node{}}
		}
	}

	// TODO: what does gin, httprouter, goji etc. do for supporting Handle() ..?
	for _, mt := range methodMap {
		m := method & mt
		if m > 0 {
			routes := mx.routes[m]

			err := routes.Insert(pattern, h)
			_ = err // ...?
		}
	}

	// log.Println("insert, tree:")
	// log.Println(mx.routes)
}

func (mx *Mux) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	mx.ServeHTTPC(context.Background(), w, r)
}

func (mx *Mux) ServeHTTPC(ctx context.Context, w http.ResponseWriter, r *http.Request) {
	var cxh Handler
	var err error
	var params map[string]string

	routes := mx.routes[methodMap[r.Method]]
	cxh, params, err = routes.Find(r.URL.Path)

	_ = err // ..

	// we give you the path.. and you give us
	// the route, urlparams?, and handler.
	// -> the returned handler will come wrapped
	// with the necessary middleware to call it.

	if cxh == nil {
		// not found..
		log.Println("** 404 **")
		w.WriteHeader(404)
		w.Write([]byte("not found"))
		return
		// panic("not found..")
	}

	// set if we have some params...? or always set...?
	ctx = context.WithValue(ctx, urlParamsCtxKey, params)

	// Serve it
	cxh.ServeHTTPC(ctx, w, r)
}
