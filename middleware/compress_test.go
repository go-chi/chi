package middleware

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

type emptyResponseWriterWrapper struct {
	inner http.ResponseWriter
}

func (e *emptyResponseWriterWrapper) Header() http.Header {
	return e.inner.Header()
}
func (e *emptyResponseWriterWrapper) Write(data []byte) (int, error) {
	return e.inner.Write(data)
}
func (e *emptyResponseWriterWrapper) WriteHeader(status int) {
	e.inner.WriteHeader(status)
}
func (e *emptyResponseWriterWrapper) Unwrap() http.ResponseWriter {
	return e.inner
}

func identityMiddleware(inner http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w = mkGenericWrapper(&emptyResponseWriterWrapper{w})
		inner.ServeHTTP(w, r)
	})
}

// TestGenericWrapperHTTP tests that when an http request is wrapped using mkGenericWrapper, it still supports the
// various interfaces that a http.response implements.
func TestGenericWrapperHTTP(t *testing.T) {
	t.Parallel()
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, cn := w.(http.CloseNotifier)
		if !cn {
			t.Fatal("request should have been a http.CloseNotifier")
		}
		_, fl := w.(http.Flusher)
		if !fl {
			t.Fatal("request should have been a http.Flusher")
		}
		_, hj := w.(http.Hijacker)
		if !hj {
			t.Fatal("request should have been a http.Hijacker")
		}
		_, rf := w.(io.ReaderFrom)
		if !rf {
			t.Fatal("request should have been a io.ReaderFrom")
		}

		w.Write([]byte("OK"))
	})

	server := httptest.NewServer(identityMiddleware(handler))
	defer server.Close()

	resp, err := http.Get(server.URL)
	if err != nil {
		t.Fatalf("could not get server: %v", err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("non 200 response: %v", resp.StatusCode)
	}
}
