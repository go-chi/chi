package middleware

import (
	"net/http"
)

type statusWriter struct {
	http.ResponseWriter

	code int
}

func (ssw *statusWriter) WriteHeader(code int) {
	ssw.code = code
	ssw.ResponseWriter.WriteHeader(code)
}
