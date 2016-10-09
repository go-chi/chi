package render

import (
	"context"
	"net/http"
)

var StatusCtxKey = &contextKey{"Status"}

// Status sets status into request context.
func Status(r *http.Request, status int) {
	*r = *r.WithContext(context.WithValue(r.Context(), StatusCtxKey, status))
}
