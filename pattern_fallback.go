//go:build !go1.23 || tinygo
// +build !go1.23 tinygo

package chi

import "net/http"

// supportsPattern is true if the Go version is 1.23 and above.
//
// If this is true, `net/http.Request` has field `Pattern`.
const supportsPattern = false

// setPattern sets the mux matched pattern in the http Request.
//
// setPattern is only supported in Go 1.23 and above so
// this is just a blank function so that it compiles.
func setPattern(rctx *Context, r *http.Request) {}
