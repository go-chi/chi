package middleware

import (
	"bytes"
	"net/http/httptest"
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
	original := httptest.NewRecorder()
	wrap := &basicWriter{ResponseWriter: original}

	var buf bytes.Buffer
	wrap.Tee(&buf)

	_, err := wrap.Write([]byte("hello world"))
	assertNoError(t, err)

	assertEqual(t, []byte("hello world"), original.Body.Bytes())
	assertEqual(t, []byte("hello world"), buf.Bytes())
}

func TestBasicWriterDiscardsWritesToOriginalResponseWriter(t *testing.T) {
	t.Run("With Tee", func(t *testing.T) {
		original := httptest.NewRecorder()
		wrap := &basicWriter{ResponseWriter: original}

		var buf bytes.Buffer
		wrap.Tee(&buf)
		wrap.Discard()

		_, err := wrap.Write([]byte("hello world"))
		assertNoError(t, err)

		assertEqual(t, 0, original.Body.Len())
		assertEqual(t, []byte("hello world"), buf.Bytes())
	})

	t.Run("Without Tee", func(t *testing.T) {
		original := httptest.NewRecorder()
		wrap := &basicWriter{ResponseWriter: original}
		wrap.Discard()

		_, err := wrap.Write([]byte("hello world"))
		assertNoError(t, err)

		assertEqual(t, 0, original.Body.Len())
	})
}
