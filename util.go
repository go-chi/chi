package chi

import "net/http"

// contextKey is a value for use with context.WithValue. It's used as
// a pointer so it fits in an interface{} without allocation. This technique
// for defining context keys was copied from Go 1.7's new use of context in net/http.
type contextKey struct {
	name string
}

func (k *contextKey) String() string {
	return "chi context value " + k.name
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
	mx := r.GetMux() // TODO: is there a better way ....?
	mx.AppendMiddleware(mx.middlewares...)
	mx.buildRouteHandler(true)
	return r
}

// chain builds a http.Handler composed of middlewares and endpoint handler in the
// order they are passed.
func chain(middlewares []func(http.Handler) http.Handler, endpoint http.Handler) http.Handler {
	// Return ahead of time if there aren't any middlewares for the chain
	if middlewares == nil || len(middlewares) == 0 {
		return endpoint
	}

	// Wrap the end handler with the middleware chain
	h := middlewares[len(middlewares)-1](endpoint)
	for i := len(middlewares) - 2; i >= 0; i-- {
		h = middlewares[i](h)
	}

	return h
}

// Respond with just the allowed methods, as required by RFC2616 for
// 405 Method not allowed.
func methodNotAllowedHandler(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(405)
	w.Write(nil)
}
