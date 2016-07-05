package middleware

// Ported from Goji's middleware, source:
// https://github.com/zenazn/goji/tree/master/web/middleware

import (
	"bufio"
	"bytes"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"time"
)

// LogEntry is a composition of various informations from a request, such as its
// execution time, its URL or the response status, for example.
type LogEntry struct {
	RequestID     string
	Method        string
	URL           string
	RemoteAddr    string
	Status        int
	BytesWritten  int
	ExecutionTime time.Duration
}

// LogAppender is a LogEntry receiver.
type LogAppender interface {
	Append(entry LogEntry)
}

// NewLogger return a middleware which will use the given appenders in order to
// publish new log entry.
func NewLogger(appenders ...LogAppender) func(next http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {

		if len(appenders) == 0 {
			return next
		}

		fn := func(w http.ResponseWriter, r *http.Request) {

			reqID := GetReqID(r.Context())
			url := getRequestURL(r)

			var lw writerProxy
			switch e := w.(type) {
			case writerProxy:
				// Reuse proxy in order to avoid a chaining of interceptor.
				lw = e
			default:
				// We have to wrap the given http.ResponseWriter with a proxy
				// in order to hook into various parts of the response process.
				lw = wrapWriter(w)
			}

			t := time.Now()

			defer func() {

				lw.SetDuration(t, time.Now())

				delta := lw.Duration()
				status := lw.Status()
				length := lw.BytesWritten()

				for _, appender := range appenders {

					if appender == nil {
						continue
					}

					appender.Append(LogEntry{
						RequestID:     reqID,
						Method:        r.Method,
						URL:           url,
						RemoteAddr:    r.RemoteAddr,
						Status:        status,
						BytesWritten:  length,
						ExecutionTime: delta,
					})

				}

			}()

			next.ServeHTTP(lw, r)
		}

		return http.HandlerFunc(fn)
	}
}

// Logger is a middleware that logs the start and end of each request, along
// with some useful data about what was requested, what the response status was,
// and how long it took to return. When standard output is a TTY, Logger will
// print in color, otherwise it will print in black and white.
//
// Logger prints a request ID if one is provided.
var Logger = NewLogger(DefaultLogAppender)

// DefaultLogAppender is the default LogAppender used by the Logger middleware.
var DefaultLogAppender LogAppender = defaultLogAppender{}

type defaultLogAppender struct{}

func (l defaultLogAppender) Append(e LogEntry) {

	buf := &bytes.Buffer{}

	if e.RequestID != "" {
		cW(buf, nYellow, "[%s] ", e.RequestID)
	}
	cW(buf, nCyan, "\"")
	cW(buf, bMagenta, "%s ", e.Method)
	cW(buf, nCyan, "%s\" ", e.URL)

	buf.WriteString("from ")
	buf.WriteString(e.RemoteAddr)
	buf.WriteString(" - ")

	status := e.Status
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

	cW(buf, bBlue, " %dB", e.BytesWritten)

	buf.WriteString(" in ")
	if e.ExecutionTime < 500*time.Millisecond {
		cW(buf, nGreen, "%s", e.ExecutionTime)
	} else if e.ExecutionTime < 5*time.Second {
		cW(buf, nYellow, "%s", e.ExecutionTime)
	} else {
		cW(buf, nRed, "%s", e.ExecutionTime)
	}

	log.Print(buf.String())
}

var (
	httpScheme      = "http"
	httpsScheme     = "https"
	xForwardedProto = http.CanonicalHeaderKey("X-Forwarded-Proto")
)

func getRequestURL(r *http.Request) string {

	scheme := httpScheme

	// Is HTTPS with TLS connection ?
	if r.TLS != nil {
		scheme = httpsScheme
	}

	// or with a reverse proxy ?
	if xfp := r.Header.Get(xForwardedProto); xfp == httpsScheme {
		scheme = httpsScheme
	}

	return fmt.Sprintf("%s://%s%s", scheme, r.Host, r.RequestURI)
}

// writerProxy is a proxy around an http.ResponseWriter that allows you to hook
// into various parts of the response process.
//
// NOTE: writerProxy MUST remains private, use LogAppender instead if you need
// a hook for these informations.
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
	// SetDuration defines the execution time of the request.
	// If a duration is already defined, the update will be ignored.
	SetDuration(t1, t2 time.Time)
	// Duration returns the total execution time of the request.
	Duration() time.Duration
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
	code        int
	bytes       int
	tee         io.Writer
	duration    time.Duration
	hasDuration bool
	wroteHeader bool
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
func (b *basicWriter) SetDuration(t1, t2 time.Time) {
	if !b.hasDuration {
		b.hasDuration = true
		b.duration = t2.Sub(t1)
	}
}
func (b *basicWriter) Duration() time.Duration {
	return b.duration
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
