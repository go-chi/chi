package chi

import "net/http"

// NewRouter returns a new Mux object that implements the Router interface.
func NewRouter() *Mux {
	return NewMux()
}

// A Router consisting of the core routing methods used by chi's Mux,
// built using just the stdlib.
type Router interface {
	http.Handler

	Use(middlewares ...func(http.Handler) http.Handler)

	Route(pattern string, fn func(r Router)) Router
	Group(fn func(r Router)) Router

	Mount(pattern string, h http.Handler)
	Handle(pattern string, h http.Handler)
	HandleFunc(pattern string, h http.HandlerFunc)
	NotFound(h http.HandlerFunc)

	// Any(pattern string, h.HandlerFunc) // ???
	Connect(pattern string, h http.HandlerFunc)
	Head(pattern string, h http.HandlerFunc)
	Get(pattern string, h http.HandlerFunc)
	Post(pattern string, h http.HandlerFunc)
	Put(pattern string, h http.HandlerFunc)
	Patch(pattern string, h http.HandlerFunc)
	Delete(pattern string, h http.HandlerFunc)
	Trace(pattern string, h http.HandlerFunc)
	Options(pattern string, h http.HandlerFunc)
}

type Middlewares []func(http.Handler) http.Handler

func Use(middlewares ...func(http.Handler) http.Handler) Middlewares {
	return Middlewares(middlewares)
}

func (ms *Middlewares) Use(middlewares ...func(http.Handler) http.Handler) Middlewares {
	*ms = append(*ms, middlewares...)
	return *ms
}

func (ms Middlewares) Handler(h http.HandlerFunc) http.HandlerFunc {
	return chain(ms, h).ServeHTTP
}

func (ms Middlewares) Router(r Router) Router {
	// TODO .........
	return r
}

// TODO: review...
// func (ms Middlewares) Router(r Router) Router {
// 	mx := r.GetMux()
// 	mx.middlewares = append(mx.middlewares, ms...)
// 	mx.buildRouteHandler()
// 	return r
// }
