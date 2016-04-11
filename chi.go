package chi

import (
	"context"
	"net/http"
)

// NewRouter returns a new Mux object that implements the Router interface.
// It accepts an optional parent context.Context argument used by all
// request contexts useful for signaling a server shutdown.
func NewRouter(parent ...context.Context) *Mux {
	return NewMux(parent...)
}

// A Router consisting of the core routing methods used by chi's Mux,
// built using just the stdlib.
type Router interface {
	http.Handler

	Use(middlewares ...func(http.Handler) http.Handler)
	Group(fn func(r Router)) Router // TODO: rename to XXX?
	Route(pattern string, fn func(r Router)) Router // TODO: rename to Group()..?
	Mount(pattern string, handler http.Handler) // TODO: mount a Router instead of http.Handler?

	Handle(pattern string, handler http.Handler)
	NotFound(handler http.Handler)

	Connect(pattern string, handler http.Handler)
	Head(pattern string, handler http.Handler)
	Get(pattern string, handler http.Handler)
	Post(pattern string, handler http.Handler)
	Put(pattern string, handler http.Handler)
	Patch(pattern string, handler http.Handler)
	Delete(pattern string, handler http.Handler)
	Trace(pattern string, handler http.Handler)
	Options(pattern string, handler http.Handler)
}

type Middlewares []func(http.Handler) http.Handler

func (ms *Middlewares) Use(middlewares ...func(http.Handler) http.Handler) Middlewares {
	*ms = append(*ms, middlewares...)
	return *ms
}

func (ms Middlewares) Then(endpoint http.Handler) http.Handler {
	return chain(ms, endpoint)
}

func Use(middlewares ...func(http.Handler) http.Handler) Middlewares {
	return Middlewares(middlewares)
}

func HFn(hfn func(w http.ResponseWriter, r *http.Request)) http.HandlerFunc {
	return http.HandlerFunc(hfn)
}
