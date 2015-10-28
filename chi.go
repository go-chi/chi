package chi

import (
	"net/http"

	"golang.org/x/net/context"
)

func NewRouter() *Mux {
	return &Mux{}
}

type Router interface {
	http.Handler
	Handler

	Use(middlewares ...interface{})
	Group(fn func(r Router)) Router
	Route(pattern string, fn func(r Router)) Router
	Mount(pattern string, handlers ...interface{})

	Handle(pattern string, handlers ...interface{})
	Connect(pattern string, handlers ...interface{})
	Head(pattern string, handlers ...interface{})
	Get(pattern string, handlers ...interface{})
	Post(pattern string, handlers ...interface{})
	Put(pattern string, handlers ...interface{})
	Patch(pattern string, handlers ...interface{})
	Delete(pattern string, handlers ...interface{})
	Trace(pattern string, handlers ...interface{})
	Options(pattern string, handlers ...interface{})
}

// NOTE: hopefully, once net/context makes it into the stdlib and
// net/http supports a request context, we will remove these signatures.

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

func URLParams(ctx context.Context) map[string]string {
	if urlParams, ok := ctx.Value(URLParamsCtxKey).(map[string]string); ok {
		return urlParams
	}
	return nil
}
