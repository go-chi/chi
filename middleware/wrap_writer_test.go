package middleware

import (
	"bufio"
	"fmt"
	"io"
	"net"
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

func TestWrapResponseWriter(t *testing.T) {
	tt := []struct {
		w          http.ResponseWriter
		protoMajor int
		fl         bool // http.Flusher
		hj         bool // http.Hijacker
		rf         bool // io.ReaderFrom
		ps         bool // http.Pusher
	}{
		{protoMajor: 1, w: none{}},
		{protoMajor: 1, w: flusher{}, fl: true},
		{protoMajor: 1, w: hijacker{}, hj: true},
		{protoMajor: 1, w: readerFrom{}, rf: true},
		{protoMajor: 1, w: flusherHijacker{}, fl: true, hj: true},
		{protoMajor: 1, w: flusherReaderFrom{}, fl: true, rf: true},
		{protoMajor: 1, w: hijackerReaderFrom{}, hj: true, rf: true},
		{protoMajor: 1, w: flusherHijackerReaderFrom{}, fl: true, hj: true, rf: true},

		{protoMajor: 2, w: none{}},
		{protoMajor: 2, w: flusher{}, fl: true},
		{protoMajor: 2, w: hijacker{}, hj: true},
		{protoMajor: 2, w: readerFrom{}, rf: true},
		{protoMajor: 2, w: pusher{}, ps: true},
		{protoMajor: 2, w: flusherPusher{}, fl: true, ps: true},
		{protoMajor: 2, w: readerFromPusher{}, rf: true, ps: true},
		{protoMajor: 2, w: hijackerPusher{}, hj: true, ps: true},
		{protoMajor: 2, w: flusherHijacker{}, fl: true, hj: true},
		{protoMajor: 2, w: flusherReaderFrom{}, fl: true, rf: true},
		{protoMajor: 2, w: hijackerReaderFrom{}, hj: true, rf: true},
		{protoMajor: 2, w: flusherHijackerReaderFrom{}, fl: true, hj: true, rf: true},
		{protoMajor: 2, w: flusherHijackerPusher{}, fl: true, hj: true, ps: true},
		{protoMajor: 2, w: flusherReaderFromPusher{}, fl: true, rf: true, ps: true},
		{protoMajor: 2, w: hijackerReaderFromPusher{}, hj: true, rf: true, ps: true},
		{protoMajor: 2, w: flusherHijackerReaderFromPusher{}, fl: true, hj: true, rf: true, ps: true},
	}

	// Double check the correctness of the test cases.
	duplicates := map[interface{}]struct{}{}
	for _, tc := range tt {
		if fl := strings.Contains(strings.ToLower(fmt.Sprintf("%T", tc.w)), "flusher"); fl != tc.fl {
			t.Fatalf("test case is wrong, %T{} should have fl: %v", tc.w, fl)
		}
		if hj := strings.Contains(strings.ToLower(fmt.Sprintf("%T", tc.w)), "hijacker"); hj != tc.hj {
			t.Fatalf("test case is wrong, %T{} should have hj: %v", tc.w, hj)
		}
		if rf := strings.Contains(strings.ToLower(fmt.Sprintf("%T", tc.w)), "readerfrom"); rf != tc.rf {
			t.Fatalf("test case is wrong, %T{} should have rf: %v", tc.w, rf)
		}
		if ps := strings.Contains(strings.ToLower(fmt.Sprintf("%T", tc.w)), "pusher"); ps != tc.ps {
			t.Fatalf("test case is wrong, %T{} should have ps: %v", tc.w, ps)
		}

		if _, ok := duplicates[tc]; ok {
			t.Fatalf("test case already exists: %+v", tc)
		}
		duplicates[tc] = struct{}{}
	}

	var countErrs int

	for _, tc := range tt {
		w := NewWrapResponseWriter(tc.w, tc.protoMajor)
		_, fl := w.(http.Flusher)
		_, hj := w.(http.Hijacker)
		_, rf := w.(io.ReaderFrom)
		_, ps := w.(http.Pusher)

		if fl != tc.fl {
			t.Errorf("%T(%T).(http.Flusher) is %v", w, tc.w, fl)
			countErrs++
		}

		if hj != tc.hj {
			t.Errorf("%T(%T).(http.Hijacker) is %v", w, tc.w, hj)
			countErrs++
		}

		if rf != tc.rf {
			t.Errorf("%T(%T).(io.ReaderFrom) is %v", w, tc.w, rf)
			countErrs++
		}

		if ps != tc.ps {
			t.Errorf("%T(%T).(http.Pusher) is %v", w, tc.w, ps)
			countErrs++
		}
	}

	if countErrs != 0 {
		t.Errorf("%v/%v test cases passed", len(tt)*4-countErrs, len(tt)*4)
	}
}

type none struct {
	http.ResponseWriter
}

type flusher struct {
	http.ResponseWriter
}

func (flusher) Flush() {}

type hijacker struct {
	http.ResponseWriter
}

func (hijacker) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	return nil, nil, nil
}

type readerFrom struct {
	http.ResponseWriter
}

func (readerFrom) ReadFrom(r io.Reader) (int64, error) {
	return 0, nil
}

type pusher struct {
	http.ResponseWriter
}

func (pusher) Push(target string, opts *http.PushOptions) error {
	return nil
}

type flusherHijacker struct {
	http.ResponseWriter
	flusher
	hijacker
}

type flusherReaderFrom struct {
	http.ResponseWriter
	flusher
	readerFrom
}

type hijackerReaderFrom struct {
	http.ResponseWriter
	hijacker
	readerFrom
}

type flusherHijackerReaderFrom struct {
	http.ResponseWriter
	flusher
	hijacker
	readerFrom
}

type flusherPusher struct {
	http.ResponseWriter
	flusher
	pusher
}

type hijackerPusher struct {
	http.ResponseWriter
	hijacker
	pusher
}

type readerFromPusher struct {
	http.ResponseWriter
	readerFrom
	pusher
}

type flusherHijackerPusher struct {
	http.ResponseWriter
	flusher
	hijacker
	pusher
}

type flusherReaderFromPusher struct {
	http.ResponseWriter
	flusher
	readerFrom
	pusher
}

type hijackerReaderFromPusher struct {
	http.ResponseWriter
	hijacker
	readerFrom
	pusher
}

type flusherHijackerReaderFromPusher struct {
	http.ResponseWriter
	flusher
	hijacker
	readerFrom
	pusher
}
