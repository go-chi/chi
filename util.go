package chi

import (
	"fmt"
	"net/http"

	"golang.org/x/net/context"
	"golang.org/x/net/context/ctxhttp"
)

// Wrap http.Handler middleware to ctxhttp.Handler middlewares
func mwrap(middleware interface{}) func(ctxhttp.Handler) ctxhttp.Handler {
	mw := func(cxh ctxhttp.Handler) ctxhttp.Handler {
		return ctxhttp.HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
			wFn := func(ww http.ResponseWriter, rr *http.Request) {
				cxh.ServeHTTPC(ctx, ww, rr)
			}
			wFnC := func(ctx context.Context, ww http.ResponseWriter, rr *http.Request) {
				cxh.ServeHTTPC(ctx, ww, rr)
			}

			switch mw := middleware.(type) {
			default:
				panic(fmt.Sprintf("cmux: unsupported handler signature: %T", mw))
			case func(http.Handler) http.Handler:
				h := mw(http.HandlerFunc(wFn)).ServeHTTP
				h(w, r)
			case func(ctxhttp.Handler) ctxhttp.Handler:
				h := mw(ctxhttp.HandlerFunc(wFnC)).ServeHTTPC
				h(ctx, w, r)
			}
		})
	}
	return mw
}
