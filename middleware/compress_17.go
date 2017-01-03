// +build !go1.8

package middleware

import (
	"io"
	"net/http"
)

func mkGenericWrapper(orig http.ResponseWriter, wrapper responseWriterWrapper) http.ResponseWriter {
	_, cn := wrapper.(http.CloseNotifier)
	_, fl := wrapper.(http.Flusher)
	_, hj := wrapper.(http.Hijacker)
	_, rf := wrapper.(io.ReaderFrom)

	gw := genericWrapper{wrapper}
	if cn && fl && hj && rf && !ps {
		return &httpGenericWrapper{gw}
	}
	return &gw
}
