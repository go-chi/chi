// +build !go1.8

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

	gw := genericWrapper{wrapper}
	if cn && fl && hj && rf && !ps {
		return &httpGenericWrapper{gw}
	}
	return &gw
}
