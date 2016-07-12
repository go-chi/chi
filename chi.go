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

	Group(fn func(r Router)) Router
	Route(pattern string, fn func(r Router)) Router
	Mount(pattern string, rs Router)

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

	GetMux() *Mux
}
