// +build go1.8 appengine

package middleware

import (
	"net/http"
)

// CloseNotify is a middleware that cancels ctx when the underlying
// connection has gone away. It can be used to cancel long operations
// on the server when the client disconnects before the response is ready.
//
// Note: this behaviour is standard in Go 1.8+, so the middleware does nothing
// on 1.8+ and exists just for backwards compatibility.
func CloseNotify(next http.Handler) http.Handler {
	return next
}
