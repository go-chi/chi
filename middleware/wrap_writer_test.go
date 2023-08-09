package middleware

import (
	"net/http/httptest"
	"testing"
)

func TestChiWriterRemembersWroteHeaderWhenFlushed(t *testing.T) {
	cw := &chiWriter{ResponseWriter: httptest.NewRecorder()}
	cw.Flush()

	if !cw.wroteHeader {
		t.Fatal("want Flush to have set wroteHeader=true")
	}
}
