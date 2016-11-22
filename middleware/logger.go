package middleware

// Ported from Goji's middleware, source:
// https://github.com/zenazn/goji/tree/master/web/middleware

import (
	"bytes"
	"log"
	"net/http"
	"time"
)

// Logger is a middleware that logs the start and end of each request, along
// with some useful data about what was requested, what the response status was,
// and how long it took to return. When standard output is a TTY, Logger will
// print in color, otherwise it will print in black and white.
//
// Logger prints a request ID if one is provided.
func Logger(next http.Handler) http.Handler {
	fn := func(w http.ResponseWriter, r *http.Request) {
		reqID := GetReqID(r.Context())
		prefix := requestPrefix(reqID, r)
		ww := NewWrapResponseWriter(w)

		t1 := time.Now()
		defer func() {
			t2 := time.Now()
			printRequest(prefix, reqID, ww, t2.Sub(t1))
		}()

		next.ServeHTTP(ww, r)
	}

	return http.HandlerFunc(fn)
}

func requestPrefix(reqID string, r *http.Request) *bytes.Buffer {
	buf := &bytes.Buffer{}

	if reqID != "" {
		cW(buf, nYellow, "[%s] ", reqID)
	}
	cW(buf, nCyan, "\"")
	cW(buf, bMagenta, "%s ", r.Method)

	if r.TLS == nil {
		cW(buf, nCyan, "http://%s%s %s\" ", r.Host, r.RequestURI, r.Proto)
	} else {
		cW(buf, nCyan, "https://%s%s %s\" ", r.Host, r.RequestURI, r.Proto)
	}

	buf.WriteString("from ")
	buf.WriteString(r.RemoteAddr)
	buf.WriteString(" - ")

	return buf
}

func printRequest(buf *bytes.Buffer, reqID string, w WrapResponseWriter, dt time.Duration) {
	status := w.Status()
	if status == StatusClientClosedRequest {
		cW(buf, bRed, "[disconnected]")
	} else {
		switch {
		case status < 200:
			cW(buf, bBlue, "%03d", status)
		case status < 300:
			cW(buf, bGreen, "%03d", status)
		case status < 400:
			cW(buf, bCyan, "%03d", status)
		case status < 500:
			cW(buf, bYellow, "%03d", status)
		default:
			cW(buf, bRed, "%03d", status)
		}
	}

	cW(buf, bBlue, " %dB", w.BytesWritten())

	buf.WriteString(" in ")
	if dt < 500*time.Millisecond {
		cW(buf, nGreen, "%s", dt)
	} else if dt < 5*time.Second {
		cW(buf, nYellow, "%s", dt)
	} else {
		cW(buf, nRed, "%s", dt)
	}

	log.Print(buf.String())
}
