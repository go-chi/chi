package chi

import (
	"net/http"

	"golang.org/x/net/context"
)

// Handler is like net/http's http.Handler, but also includes a
// mechanism for serving requests with a context.
type Handler interface {
	ServeHTTPC(context.Context, http.ResponseWriter, *http.Request)
}

// HandlerFunc is like net/http's http.HandlerFunc, but supports a context
// object.
type HandlerFunc func(context.Context, http.ResponseWriter, *http.Request)

// ServeHTTPC wraps ServeHTTP with a context parameter.
func (h HandlerFunc) ServeHTTPC(ctx context.Context, w http.ResponseWriter, r *http.Request) {
	h(ctx, w, r)
}

// ServeHTTP provides compatibility with http.Handler.
func (h HandlerFunc) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h(context.Background(), w, r)
}

/*

m := chi.New()
chi.Router ......

*/

// TODO: add Router interface here......

// indeed... we accept multiple routers.. cji style :) whoop.
type Router interface {
	http.Handler
	Handler

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
