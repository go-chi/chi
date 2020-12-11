package middleware

import (
	"bufio"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
)

type testLoggerWriter struct {
	*httptest.ResponseRecorder
}

func (cw testLoggerWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	return nil, nil, nil
}

func TestRequestLogger(t *testing.T) {
	testHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, ok := w.(http.Hijacker)
		if !ok {
			t.Errorf("http.Hijacker is unavailable on the writer. add the interface methods.")
		}
	})

	r := httptest.NewRequest("GET", "/", nil)
	w := testLoggerWriter{
		ResponseRecorder: httptest.NewRecorder(),
	}

	handler := DefaultLogger(testHandler)
	handler.ServeHTTP(w, r)
}
