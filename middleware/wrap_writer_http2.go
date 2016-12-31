// +build go1.8

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
	_, ps := w.(http.Pusher)

	bw := basicWriter{ResponseWriter: w}
	if cn && fl && hj && rf && !ps {
		return &httpFancyWriter{bw}
	}
	if cn && fl && !hj && !rf && ps {
		return &http2FancyWriter{bw}
	}
	if fl {
		return &flushWriter{bw}
	}
	return &bw
}

// http2FancyWriter is a writer that additionally satisfies http.CloseNotifier,
// http.Flusher, and http.Pusher. It exists for the common case of wrapping the
// http.ResponseWriter that package http gives you, in order to make the proxied
// object support the full method set of the proxied object.
type http2FancyWriter struct {
	basicWriter
}

func (f *http2FancyWriter) CloseNotify() <-chan bool {
	cn := f.basicWriter.ResponseWriter.(http.CloseNotifier)
	return cn.CloseNotify()
}
func (f *http2FancyWriter) Flush() {
	fl := f.basicWriter.ResponseWriter.(http.Flusher)
	fl.Flush()
}
func (f *http2FancyWriter) Push(target string, opts *http.PushOptions) error {
	ps := f.basicWriter.ResponseWriter.(http.Pusher)
	return ps.Push(target, opts)
}

var _ http.CloseNotifier = &http2FancyWriter{}
var _ http.Flusher = &http2FancyWriter{}
var _ http.Pusher = &http2FancyWriter{}
