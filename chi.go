package chi

import (
	"context"
	"net/http"
)

// NewRouter returns a new Mux object that implements the Router interface.
// It accepts an optional parent context.Context argument used by all
// request contexts useful for signaling a server shutdown.

// TODO: remove this parent context....? does it work..? do we need it?
// or do we add our own signal to each routeContext ...?

func NewRouter(parent ...context.Context) *Mux {
	return NewMux(parent...)
}

// A Router consisting of the core routing methods used by chi's Mux,
// built using just the stdlib.
type Router interface {
	http.Handler

	Use(middlewares ...func(http.Handler) http.Handler)
	Stack(fn func(r Router)) Router
	Group(pattern string, fn func(r Router)) Router
	Mount(pattern string, h http.Handler) // TODO: mount a Router instead of http.Handler?

	Handle(pattern string, h http.Handler)
	HandleFunc(pattern string, h http.HandlerFunc)
	NotFound(h http.HandlerFunc)

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

func (ms *Middlewares) Use(middlewares ...func(http.Handler) http.Handler) Middlewares {
	*ms = append(*ms, middlewares...)
	return *ms
}

// TODO: is there a better function name than "Then()"
func (ms Middlewares) Then(endpoint http.HandlerFunc) http.HandlerFunc {
	return chain(ms, endpoint).ServeHTTP
}

func Use(middlewares ...func(http.Handler) http.Handler) Middlewares {
	return Middlewares(middlewares)
}
