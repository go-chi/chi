//go:build go1.23 && !tinygo
// +build go1.23,!tinygo

package chi

import "net/http"

// supportsPattern is true if the Go version is 1.23 and above.
//
// If this is true, `net/http.Request` has field `Pattern`.
const supportsPattern = true

// setPattern sets the mux matched pattern in the http Request.
func setPattern(rctx *Context, r *http.Request) {
	r.Pattern = rctx.routePattern
}
