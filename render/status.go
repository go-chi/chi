package render

import (
	"context"
	"net/http"
)

var statusCtxKey = &contextKey{"Status"}

// Status sets status into request context.
func Status(r *http.Request, status int) {
	*r = *r.WithContext(context.WithValue(r.Context(), statusCtxKey, status))
}
