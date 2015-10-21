package chi

import (
	"fmt"
	"net/http"

	"golang.org/x/net/context"
)

// TODO: return error too?
// TODO: make handler accept interface{} and check type here..?
func chainedHandler(middlewares []interface{}, handler Handler) Handler {
	if len(middlewares) == 0 {
		return handler
	}
	h := mwrap(middlewares[len(middlewares)-1])(handler)
	for i := len(middlewares) - 2; i >= 0; i-- {
		f := mwrap(middlewares[i])
		h = f(h)
	}
	return h
}

// Wrap http.Handler middleware to chi.Handler middlewares
func mwrap(middleware interface{}) func(Handler) Handler {
	mw := func(cxh Handler) Handler {
		return HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
			wFn := func(ww http.ResponseWriter, rr *http.Request) {
				cxh.ServeHTTPC(ctx, ww, rr)
			}
			wFnC := func(ctx context.Context, ww http.ResponseWriter, rr *http.Request) {
				cxh.ServeHTTPC(ctx, ww, rr)
			}

			switch mw := middleware.(type) {
			default:
				panic(fmt.Sprintf("chi: unsupported handler signature: %T", mw))
			case func(http.Handler) http.Handler:
				h := mw(http.HandlerFunc(wFn)).ServeHTTP
				h(w, r)
			case func(Handler) Handler:
				h := mw(HandlerFunc(wFnC)).ServeHTTPC
				h(ctx, w, r)
			}
		})
	}
	return mw
}
