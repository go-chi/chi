package chi

import "net/http"

// NewRouter returns a new Mux object that implements the Router interface.
func NewRouter() *Mux {
	return NewMux()
}

// Router consisting of the core routing methods used by chi's Mux,
// using only the standard net/http.
type Router interface {
	http.Handler

	// TODO: comment
	Use(middlewares ...func(http.Handler) http.Handler)

	// TODO: comment
	Route(pattern string, fn func(r Router)) Router

	// TODO: comment
	Group(fn func(r Router)) Router

	// TODO: comment
	Mount(pattern string, h http.Handler)

	// TODO: comment
	Handle(pattern string, h http.Handler)
	HandleFunc(pattern string, h http.HandlerFunc)

	// TODO: comment
	Connect(pattern string, h http.HandlerFunc)
	Head(pattern string, h http.HandlerFunc)
	Get(pattern string, h http.HandlerFunc)
	Post(pattern string, h http.HandlerFunc)
	Put(pattern string, h http.HandlerFunc)
	Patch(pattern string, h http.HandlerFunc)
	Delete(pattern string, h http.HandlerFunc)
	Trace(pattern string, h http.HandlerFunc)
	Options(pattern string, h http.HandlerFunc)

	// TODO: comment
	NotFound(h http.HandlerFunc)
}

// Middlewares type is a slice of standard middleware handlers with methods
// to compose middleware chains and http.Handler's.
type Middlewares []func(http.Handler) http.Handler

// Use returns a Middlewares slice.
func Use(middlewares ...func(http.Handler) http.Handler) Middlewares {
	return Middlewares(middlewares)
}

// Use appends additional middleware handlers to the middlewares slice.
func (ms *Middlewares) Use(middlewares ...func(http.Handler) http.Handler) Middlewares {
	*ms = append(*ms, middlewares...)
	return *ms
}

// Handler builds and returns a http.Handler from the chain of middlewares,
// with `h http.Handler` as the final handler.
func (ms Middlewares) Handler(h http.Handler) http.HandlerFunc {
	return Chain(ms, h).ServeHTTP
}

// Handler builds and returns a http.HandlerFunc from the chain of middlewares,
// with `h http.HandlerFunc` as the final handler.
func (ms Middlewares) HandlerFunc(h http.HandlerFunc) http.HandlerFunc {
	return Chain(ms, h).ServeHTTP
}
