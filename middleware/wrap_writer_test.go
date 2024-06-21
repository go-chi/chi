package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
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

func TestBasicWriterComputesElapsedWriteTime(t *testing.T) {
	const delay = 50 * time.Millisecond
	rw := &basicWriter{ResponseWriter: &DelayedResponseWriter{ResponseWriter: httptest.NewRecorder(), Delay: delay}}

	if rw.ElapsedWriteTime() != 0 {
		t.Fatal("write time should be 0 before any writes")
	}

	startTime := time.Now()

	rw.WriteHeader(http.StatusOK)
	totalElapsedTime := time.Since(startTime)
	if writeTime := rw.ElapsedWriteTime(); writeTime < delay || writeTime > totalElapsedTime {
		t.Fatalf("elapsed write time (%s) is not in the expected range (%s, %s)", writeTime, delay, totalElapsedTime)
	}

	if _, err := rw.Write([]byte("hello")); err != nil {
		t.Fatal(err)
	}
	totalElapsedTime = time.Since(startTime)
	if writeTime := rw.ElapsedWriteTime(); writeTime < delay*2 || writeTime > totalElapsedTime {
		t.Fatalf("elapsed write time (%s) is not in the expected range (%s, %s)", writeTime, delay*2, totalElapsedTime)
	}
}

type DelayedResponseWriter struct {
	http.ResponseWriter
	Delay time.Duration
}

func (w *DelayedResponseWriter) WriteHeader(statusCode int) {
	time.Sleep(w.Delay)
	w.ResponseWriter.WriteHeader(statusCode)
}

func (w *DelayedResponseWriter) Write(b []byte) (int, error) {
	time.Sleep(w.Delay)
	return w.ResponseWriter.Write(b)
}
