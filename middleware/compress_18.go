// +build go1.8

package middleware

import (
	"io"
	"net/http"
)

func mkGenericWrapper(wrapper responseWriterWrapper) http.ResponseWriter {
	orig := wrapper.Unwrap()
	_, cn := orig.(http.CloseNotifier)
	_, fl := orig.(http.Flusher)
	_, hj := orig.(http.Hijacker)
	_, rf := orig.(io.ReaderFrom)
	_, ps := orig.(http.Pusher)

	gw := genericWrapper{wrapper}
	if cn && fl && !hj && !rf && ps {
		return &http2GenericWrapper{gw}
	}
	if cn && fl && hj && rf && !ps {
		return &httpGenericWrapper{gw}
	}
	return &gw
}

type http2GenericWrapper struct {
	genericWrapper
}

func (h *http2GenericWrapper) CloseNotify() <-chan bool {
	if cn, ok := h.genericWrapper.inner.(http.CloseNotifier); ok {
		return cn.CloseNotify()
	}

	return h.genericWrapper.inner.Unwrap().(http.CloseNotifier).CloseNotify()
}
func (h *http2GenericWrapper) Flush() {
	if f, ok := h.genericWrapper.inner.(http.Flusher); ok {
		f.Flush()
		return
	}

	h.genericWrapper.inner.Unwrap().(http.Flusher).Flush()
}
func (h *http2GenericWrapper) Push(path string, opts *http.PushOptions) error {
	if p, ok := h.genericWrapper.inner.(http.Pusher); ok {
		return p.Push(path, opts)
	}

	return h.genericWrapper.inner.Unwrap().(http.Pusher).Push(path, opts)
}

var _ http.ResponseWriter = &http2GenericWrapper{}
var _ http.CloseNotifier = &http2GenericWrapper{}
var _ http.Flusher = &http2GenericWrapper{}
var _ http.Pusher = &http2GenericWrapper{}
