package middleware

import (
	"bytes"
	"context"
	"log"
	"net/http"
	"os"
	"time"
)

var (
	LogEntryCtxKey = &contextKey{"LogEntry"}

	DefaultLogger = RequestLogger(&DefaultLogFormatter{Logger: log.New(os.Stdout, "", log.LstdFlags)})
)

// Logger is a middleware that logs the start and end of each request, along
// with some useful data about what was requested, what the response status was,
// and how long it took to return. When standard output is a TTY, Logger will
// print in color, otherwise it will print in black and white.
//
// Logger prints a request ID if one is provided.
func Logger(next http.Handler) http.Handler {
	return DefaultLogger(next)
}

func RequestLogger(f LogFormatter) func(next http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		fn := func(w http.ResponseWriter, r *http.Request) {
			entry := f.NewLogEntry(r)
			ww := NewWrapResponseWriter(w, r.ProtoMajor)

			t1 := time.Now()
			defer func() {
				t2 := time.Now()
				entry.Write(ww.Status(), ww.BytesWritten(), t2.Sub(t1))
			}()

			next.ServeHTTP(ww, WithLogEntry(r, entry))
		}
		return http.HandlerFunc(fn)
	}
}

type LogFormatter interface {
	NewLogEntry(r *http.Request) LogEntry
}

type LogEntry interface {
	Write(status, bytes int, elapsed time.Duration)
	Panic(v interface{}, stack []byte)
}

func GetLogEntry(r *http.Request) LogEntry {
	entry, _ := r.Context().Value(LogEntryCtxKey).(LogEntry)
	return entry
}

func WithLogEntry(r *http.Request, entry LogEntry) *http.Request {
	r = r.WithContext(context.WithValue(r.Context(), LogEntryCtxKey, entry))
	return r
}

type DefaultLogFormatter struct {
	Logger *log.Logger
}

func (l *DefaultLogFormatter) NewLogEntry(r *http.Request) LogEntry {
	entry := &defaultLogEntry{
		DefaultLogFormatter: l,
		request:             r,
		buf:                 &bytes.Buffer{},
	}

	reqID := GetReqID(r.Context())
	if reqID != "" {
		cW(entry.buf, nYellow, "[%s] ", reqID)
	}
	cW(entry.buf, nCyan, "\"")
	cW(entry.buf, bMagenta, "%s ", r.Method)

	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	cW(entry.buf, nCyan, "%s://%s%s %s\" ", scheme, r.Host, r.RequestURI, r.Proto)

	entry.buf.WriteString("from ")
	entry.buf.WriteString(r.RemoteAddr)
	entry.buf.WriteString(" - ")

	return entry
}

type defaultLogEntry struct {
	*DefaultLogFormatter
	request *http.Request
	buf     *bytes.Buffer
}

func (l *defaultLogEntry) Write(status, bytes int, elapsed time.Duration) {
	if status == StatusClientClosedRequest {
		cW(l.buf, bRed, "[disconnected]")
	} else {
		switch {
		case status < 200:
			cW(l.buf, bBlue, "%03d", status)
		case status < 300:
			cW(l.buf, bGreen, "%03d", status)
		case status < 400:
			cW(l.buf, bCyan, "%03d", status)
		case status < 500:
			cW(l.buf, bYellow, "%03d", status)
		default:
			cW(l.buf, bRed, "%03d", status)
		}
	}

	cW(l.buf, bBlue, " %dB", bytes)

	l.buf.WriteString(" in ")
	if elapsed < 500*time.Millisecond {
		cW(l.buf, nGreen, "%s", elapsed)
	} else if elapsed < 5*time.Second {
		cW(l.buf, nYellow, "%s", elapsed)
	} else {
		cW(l.buf, nRed, "%s", elapsed)
	}

	l.Logger.Print(l.buf.String())
}

func (l *defaultLogEntry) Panic(v interface{}, stack []byte) {
	panicEntry := l.NewLogEntry(l.request).(*defaultLogEntry)
	cW(panicEntry.buf, bRed, "panic: %+v", v)
	l.Logger.Print(panicEntry.buf.String())
	l.Logger.Print(string(stack))
}
