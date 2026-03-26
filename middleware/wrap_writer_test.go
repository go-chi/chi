package middleware

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHttpFancyWriterRemembersWroteHeaderWhenFlushed(t *testing.T) {
	f := &httpFancyWriter{basicWriter: basicWriter{ResponseWriter: httptest.NewRecorder()}}
	f.Flush()

	if !f.wroteHeader {
		t.Fatal("want Flush to have set wroteHeader=true")
	}
}

func TestHttp2FancyWriterRemembersWroteHeaderWhenFlushed(t *testing.T) {
	f := &http2FancyWriter{basicWriter{ResponseWriter: httptest.NewRecorder()}}
	f.Flush()

	if !f.wroteHeader {
		t.Fatal("want Flush to have set wroteHeader=true")
	}
}

func TestBasicWritesTeesWritesWithoutDiscard(t *testing.T) {
	// explicitly create the struct instead of NewRecorder to control the value of Code
	original := &httptest.ResponseRecorder{
		HeaderMap: make(http.Header),
		Body:      new(bytes.Buffer),
	}
	wrap := &basicWriter{ResponseWriter: original}

	var buf bytes.Buffer
	wrap.Tee(&buf)

	_, err := wrap.Write([]byte("hello world"))
	assertNoError(t, err)

	assertEqual(t, 200, original.Code)
	assertEqual(t, []byte("hello world"), original.Body.Bytes())
	assertEqual(t, []byte("hello world"), buf.Bytes())
	assertEqual(t, 11, wrap.BytesWritten())
}

func TestFancyWriterReadFromBytesCounting(t *testing.T) {
	t.Run("With Tee", func(t *testing.T) {
		original := &httptest.ResponseRecorder{
			HeaderMap: make(http.Header),
			Body:      new(bytes.Buffer),
		}
		f := &httpFancyWriter{basicWriter: basicWriter{ResponseWriter: original}}

		var tee bytes.Buffer
		f.Tee(&tee)

		data := "hello world"
		n, err := f.ReadFrom(strings.NewReader(data))
		assertNoError(t, err)
		assertEqual(t, int64(len(data)), n)

		// BytesWritten must equal the actual data length, not double it.
		assertEqual(t, len(data), f.BytesWritten())
		assertEqual(t, []byte(data), original.Body.Bytes())
		assertEqual(t, []byte(data), tee.Bytes())
	})

	t.Run("Without Tee", func(t *testing.T) {
		recorder := &readerFromRecorder{
			ResponseRecorder: httptest.ResponseRecorder{
				HeaderMap: make(http.Header),
				Body:      new(bytes.Buffer),
			},
		}
		f := &httpFancyWriter{basicWriter: basicWriter{ResponseWriter: recorder}}

		data := "hello world"
		n, err := f.ReadFrom(strings.NewReader(data))
		assertNoError(t, err)
		assertEqual(t, int64(len(data)), n)

		assertEqual(t, len(data), f.BytesWritten())
		assertEqual(t, []byte(data), recorder.Body.Bytes())
	})
}

// readerFromRecorder wraps httptest.ResponseRecorder and implements io.ReaderFrom.
// This satisfies the type assertion in the non-tee path of httpFancyWriter.ReadFrom.
type readerFromRecorder struct {
	httptest.ResponseRecorder
}

func (r *readerFromRecorder) ReadFrom(src io.Reader) (int64, error) {
	return io.Copy(r.Body, src)
}

func TestBasicWriterDiscardsWritesToOriginalResponseWriter(t *testing.T) {
	t.Run("With Tee", func(t *testing.T) {
		// explicitly create the struct instead of NewRecorder to control the value of Code
		original := &httptest.ResponseRecorder{
			HeaderMap: make(http.Header),
			Body:      new(bytes.Buffer),
		}
		wrap := &basicWriter{ResponseWriter: original}

		var buf bytes.Buffer
		wrap.Tee(&buf)
		wrap.Discard()

		_, err := wrap.Write([]byte("hello world"))
		assertNoError(t, err)

		assertEqual(t, 0, original.Code) // wrapper shouldn't call WriteHeader implicitly
		assertEqual(t, 0, original.Body.Len())
		assertEqual(t, []byte("hello world"), buf.Bytes())
		assertEqual(t, 11, wrap.BytesWritten())
	})

	t.Run("Without Tee", func(t *testing.T) {
		// explicitly create the struct instead of NewRecorder to control the value of Code
		original := &httptest.ResponseRecorder{
			HeaderMap: make(http.Header),
			Body:      new(bytes.Buffer),
		}
		wrap := &basicWriter{ResponseWriter: original}
		wrap.Discard()

		_, err := wrap.Write([]byte("hello world"))
		assertNoError(t, err)

		assertEqual(t, 0, original.Code) // wrapper shouldn't call WriteHeader implicitly
		assertEqual(t, 0, original.Body.Len())
		assertEqual(t, 11, wrap.BytesWritten())
	})
}
