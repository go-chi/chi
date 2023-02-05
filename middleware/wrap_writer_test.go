package middleware

import (
	"net/http/httptest"
	"testing"
)

func TestHttpFancyWriterRemembersWroteHeaderWhenFlushed(t *testing.T) {
	f := &httpFancyWriter{chiWriter: chiWriter{ResponseWriter: httptest.NewRecorder()}}
	f.Flush()

	if !f.wroteHeader {
		t.Fatal("want Flush to have set wroteHeader=true")
	}
}

func TestHttp2FancyWriterRemembersWroteHeaderWhenFlushed(t *testing.T) {
	f := &http2FancyWriter{chiWriter{ResponseWriter: httptest.NewRecorder()}}
	f.Flush()

	if !f.wroteHeader {
		t.Fatal("want Flush to have set wroteHeader=true")
	}
}
