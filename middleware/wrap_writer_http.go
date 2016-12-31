// +build !go1.8

package middleware

import (
	"io"
	"net/http"
)

// NewWrapResponseWriter wraps an http.ResponseWriter, returning a proxy that allows you to
// hook into various parts of the response process.
func NewWrapResponseWriter(w http.ResponseWriter) WrapResponseWriter {
	_, cn := w.(http.CloseNotifier)
	_, fl := w.(http.Flusher)
	_, hj := w.(http.Hijacker)
	_, rf := w.(io.ReaderFrom)

	bw := basicWriter{ResponseWriter: w}
	if cn && fl && hj && rf {
		return &httpFancyWriter{bw}
	}
	if fl {
		return &flushWriter{bw}
	}
	return &bw
}
