package middleware

import (
	"bytes"
	"errors"
	"net/http"
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

func TestErrorCapturing(t *testing.T) {

	t.Run("Captures and retrieves single error", func(t *testing.T) {
		original := httptest.NewRecorder()
		wrap := NewWrapResponseWriter(original, 1)

		testErr := errors.New("test error")
		wrap.CaptureErr(testErr)

		capturedErr := wrap.Err()
		if capturedErr == nil {
			t.Fatal("Expected to capture an error, got nil")
		}
		if capturedErr.Error() != testErr.Error() {
			t.Fatalf("Expected error message %q, got %q", testErr.Error(), capturedErr.Error())
		}
	})

	t.Run("Captures and joins multiple errors", func(t *testing.T) {
		original := httptest.NewRecorder()
		wrap := NewWrapResponseWriter(original, 1)

		err1 := errors.New("first error")
		err2 := errors.New("second error")

		wrap.CaptureErr(err1)
		wrap.CaptureErr(err2)

		capturedErr := wrap.Err()
		if capturedErr == nil {
			t.Fatal("Expected to capture errors, got nil")
		}

		if !errors.Is(capturedErr, err1) || !errors.Is(capturedErr, err2) {
			t.Fatalf("Expected combined error message to contain both errors, got: %q", capturedErr)
		}
	})

	t.Run("Returns nil when no errors are captured", func(t *testing.T) {
		original := httptest.NewRecorder()
		wrap := NewWrapResponseWriter(original, 1)

		capturedErr := wrap.Err()
		if capturedErr != nil {
			t.Fatalf("Expected nil error when nothing captured, got: %v", capturedErr)
		}
	})

	t.Run("Handles nil errors gracefully", func(t *testing.T) {
		original := httptest.NewRecorder()
		wrap := NewWrapResponseWriter(original, 1)

		// Capturing nil should be a no-op
		wrap.CaptureErr(nil)

		capturedErr := wrap.Err()
		if capturedErr != nil {
			t.Fatalf("Expected nil error after capturing nil, got: %v", capturedErr)
		}

		// Capture a real error after nil
		testErr := errors.New("real error")
		wrap.CaptureErr(testErr)

		capturedErr = wrap.Err()
		if capturedErr == nil || capturedErr.Error() != testErr.Error() {
			t.Fatalf("Expected to get error %q after nil, got: %v", testErr.Error(), capturedErr)
		}
	})
}
