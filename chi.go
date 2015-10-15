package chi

import (
	"net/http"

	"golang.org/x/net/context"
	"golang.org/x/net/context/ctxhttp"
)

/*

m := chi.New()
chi.Router ......

*/

// TODO: add Router interface here......

// indeed... we accept multiple routers.. cji style :) whoop.
type Router interface {
	http.Handler
	ctxhttp.Handler

	Use(middlewares ...interface{})
	Group(fn func(r Router)) Router
	Route(pattern string, fn func(r Router)) Router
	Mount(path string, handlers ...interface{})

	Handle(pattern interface{}, handlers ...interface{})
	Connect(pattern interface{}, handlers ...interface{}) // ??...
	Head(pattern interface{}, handlers ...interface{})
	Get(pattern interface{}, handlers ...interface{})
	Post(pattern interface{}, handlers ...interface{})
	Put(pattern interface{}, handlers ...interface{})
	Patch(pattern interface{}, handlers ...interface{})
	Delete(pattern interface{}, handlers ...interface{})
	Trace(pattern interface{}, handlers ...interface{})
	Options(pattern interface{}, handlers ...interface{})
}

func New() *Mux { // return Router?
	return &Mux{}
}

func URLParams(ctx context.Context) map[string]string {
	if urlParams, ok := ctx.Value(urlParamsCtxKey).(map[string]string); ok {
		return urlParams
	}
	return map[string]string{} // TODO: or return emptyURLParams ...?
}
