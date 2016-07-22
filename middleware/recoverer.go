package middleware

// Ported from Goji's middleware, source:
// https://github.com/zenazn/goji/tree/master/web/middleware

import (
	"bytes"
	"log"
	"net/http"
	"runtime/debug"
)

// Recoverer is a middleware that recovers from panics, logs the panic (and a
// backtrace), and returns a HTTP 500 (Internal Server Error) status if
// possible.
//
// Recoverer prints a request ID if one is provided.
func Recoverer(next http.Handler) http.Handler {
	fn := func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if err := recover(); err != nil {
				reqID := GetReqID(r.Context())
				prefix := requestPrefix(reqID, r)
				printPanic(prefix, reqID, err)
				debug.PrintStack()
				http.Error(w, http.StatusText(500), 500)
			}
		}()

		next.ServeHTTP(w, r)
	}

	return http.HandlerFunc(fn)
}

func printPanic(buf *bytes.Buffer, reqID string, err interface{}) {
	cW(buf, bRed, "panic: %+v", err)
	log.Print(buf.String())
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
