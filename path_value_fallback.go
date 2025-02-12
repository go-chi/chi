//go:build !go1.22 || tinygo
// +build !go1.22 tinygo

package chi

import "net/http"

// supportsPathValue is true if the Go version is 1.22 and above.
//
// If this is true, `net/http.Request` has methods `SetPathValue` and `PathValue`.
const supportsPathValue = false

// setPathValue sets the path values in the Request value
// based on the provided request context.
//
// setPathValue is only supported in Go 1.22 and above so
// this is just a blank function so that it compiles.
func setPathValue(rctx *Context, r *http.Request) {
}
