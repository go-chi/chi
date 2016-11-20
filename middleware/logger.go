package middleware

// Ported from Goji's middleware, source:
// https://github.com/zenazn/goji/tree/master/web/middleware

import (
	"bufio"
	"bytes"
	"io"
	"log"
	"net"
	"net/http"
	"runtime/debug"
	"time"
)

// DefaultLogFormatter exists so we have somewhere to attach the default log formatting logic
type DefaultLogFormatter struct{}

// LogFormatter allows you to customize this middleware's (and Recoverer's) output format.
type LogFormatter interface {
	FormatLog(r *http.Request, status, nbytes int, elapsed time.Duration, err error)
}

var defaultLogFormatter *DefaultLogFormatter

// Logger is a middleware that logs the start and end of each request, along
// with some useful data about what was requested, what the response status was,
// and how long it took to return. When standard output is a TTY, Logger will
// print in color, otherwise it will print in black and white.
//
// Logger prints a request ID if one is provided.
func Logger(next http.Handler) http.Handler {
	return FormattedLogger(defaultLogFormatter, next)
}

// FormattedLogger is a middleware that allows you to customize what is logged
// for each request/response.
func FormattedLogger(f LogFormatter, next http.Handler) http.Handler {
	fn := func(w http.ResponseWriter, r *http.Request) {
		lw := wrapWriter(w)

		t1 := time.Now()
		defer func() {
			t2 := time.Now()
			f.FormatLog(r, lw.Status(), lw.BytesWritten(), t2.Sub(t1), nil)
		}()

		next.ServeHTTP(lw, r)
	}

	return http.HandlerFunc(fn)
}

// FormatLog writes out a formatted log entry
func (l *DefaultLogFormatter) FormatLog(r *http.Request, status, nbytes int, elapsed time.Duration, err error) {
	var buf *bytes.Buffer = &bytes.Buffer{}

	reqID := GetReqID(r.Context())
	if reqID != "" {
		cW(buf, nYellow, "[%s] ", reqID)
	}
	cW(buf, nCyan, "\"")
	cW(buf, bMagenta, "%s ", r.Method)

	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	cW(buf, nCyan, "%s://%s%s %s\" ", scheme, r.Host, r.RequestURI, r.Proto)

	buf.WriteString("from ")
	buf.WriteString(r.RemoteAddr)
	buf.WriteString(" - ")

	if err == nil {
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

		cW(buf, bBlue, " %dB", nbytes)

		buf.WriteString(" in ")
		if elapsed < 500*time.Millisecond {
			cW(buf, nGreen, "%s", elapsed)
		} else if elapsed < 5*time.Second {
			cW(buf, nYellow, "%s", elapsed)
		} else {
			cW(buf, nRed, "%s", elapsed)
		}
	} else {
		cW(buf, bRed, "%+v", err)
	}

	log.Print(buf.String())

	if err != nil {
		debug.PrintStack()
	}
}

// writerProxy is a proxy around an http.ResponseWriter that allows you to hook
// into various parts of the response process.
type writerProxy interface {
	http.ResponseWriter
	// Status returns the HTTP status of the request, or 0 if one has not
	// yet been sent.
	Status() int
	// BytesWritten returns the total number of bytes sent to the client.
	BytesWritten() int
	// Tee causes the response body to be written to the given io.Writer in
	// addition to proxying the writes through. Only one io.Writer can be
	// tee'd to at once: setting a second one will overwrite the first.
	// Writes will be sent to the proxy before being written to this
	// io.Writer. It is illegal for the tee'd writer to be modified
	// concurrently with writes.
	Tee(io.Writer)
	// Unwrap returns the original proxied target.
	Unwrap() http.ResponseWriter
}

// WrapWriter wraps an http.ResponseWriter, returning a proxy that allows you to
// hook into various parts of the response process.
func wrapWriter(w http.ResponseWriter) writerProxy {
	_, cn := w.(http.CloseNotifier)
	_, fl := w.(http.Flusher)
	_, hj := w.(http.Hijacker)
	_, rf := w.(io.ReaderFrom)

	bw := basicWriter{ResponseWriter: w}
	if cn && fl && hj && rf {
		return &fancyWriter{bw}
	}
	if fl {
		return &flushWriter{bw}
	}
	return &bw
}

// basicWriter wraps a http.ResponseWriter that implements the minimal
// http.ResponseWriter interface.
type basicWriter struct {
	http.ResponseWriter
	wroteHeader bool
	code        int
	bytes       int
	tee         io.Writer
}

func (b *basicWriter) WriteHeader(code int) {
	if !b.wroteHeader {
		b.code = code
		b.wroteHeader = true
		b.ResponseWriter.WriteHeader(code)
	}
}
func (b *basicWriter) Write(buf []byte) (int, error) {
	b.WriteHeader(http.StatusOK)
	n, err := b.ResponseWriter.Write(buf)
	if b.tee != nil {
		_, err2 := b.tee.Write(buf[:n])
		// Prefer errors generated by the proxied writer.
		if err == nil {
			err = err2
		}
	}
	b.bytes += n
	return n, err
}
func (b *basicWriter) maybeWriteHeader() {
	if !b.wroteHeader {
		b.WriteHeader(http.StatusOK)
	}
}
func (b *basicWriter) Status() int {
	return b.code
}
func (b *basicWriter) BytesWritten() int {
	return b.bytes
}
func (b *basicWriter) Tee(w io.Writer) {
	b.tee = w
}
func (b *basicWriter) Unwrap() http.ResponseWriter {
	return b.ResponseWriter
}

// fancyWriter is a writer that additionally satisfies http.CloseNotifier,
// http.Flusher, http.Hijacker, and io.ReaderFrom. It exists for the common case
// of wrapping the http.ResponseWriter that package http gives you, in order to
// make the proxied object support the full method set of the proxied object.
type fancyWriter struct {
	basicWriter
}

func (f *fancyWriter) CloseNotify() <-chan bool {
	cn := f.basicWriter.ResponseWriter.(http.CloseNotifier)
	return cn.CloseNotify()
}
func (f *fancyWriter) Flush() {
	fl := f.basicWriter.ResponseWriter.(http.Flusher)
	fl.Flush()
}
func (f *fancyWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hj := f.basicWriter.ResponseWriter.(http.Hijacker)
	return hj.Hijack()
}
func (f *fancyWriter) ReadFrom(r io.Reader) (int64, error) {
	if f.basicWriter.tee != nil {
		return io.Copy(&f.basicWriter, r)
	}
	rf := f.basicWriter.ResponseWriter.(io.ReaderFrom)
	f.basicWriter.maybeWriteHeader()
	return rf.ReadFrom(r)
}

var _ http.CloseNotifier = &fancyWriter{}
var _ http.Flusher = &fancyWriter{}
var _ http.Hijacker = &fancyWriter{}
var _ io.ReaderFrom = &fancyWriter{}

type flushWriter struct {
	basicWriter
}

func (f *flushWriter) Flush() {
	fl := f.basicWriter.ResponseWriter.(http.Flusher)
	fl.Flush()
}

var _ http.Flusher = &flushWriter{}
