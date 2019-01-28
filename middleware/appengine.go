package middleware

import (
	"context"
	"net/http"

	"google.golang.org/appengine"
)

var (
	// AppEngineCtxKey is the context.Context key to store the context derived from AppEngine.
	AppEngineCtxKey = contextKey{name: "AppengineContext"}
)

// AppEngineContext wraps an http.Handler to set the appengine context to the context.
// because AppEngine APIs `google.golang.org.appengine` require the context derived from an AppEngine context.
//
//     if actx, ok := ctx.Value(middleware.AppEngineCtxKey).(context.Context); ok {
//         ctx = actx
//     }
func AppEngineContext(next http.Handler) http.Handler {
	fn := func(w http.ResponseWriter, r *http.Request) {
		actx := appengine.NewContext(r)
		rctx := r.Context()
		ctx := context.WithValue(rctx, AppEngineCtxKey, actx)
		next.ServeHTTP(w, r.WithContext(ctx))
	}
	return http.HandlerFunc(fn)
}
