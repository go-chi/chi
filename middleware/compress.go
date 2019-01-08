package middleware

import (
	"bufio"
	"compress/flate"
	"compress/gzip"
	"errors"
	"io"
	"net"
	"net/http"
	"regexp"
	"sort"
	"strings"
)

var encoders = map[string]EncoderFunc{}

var acceptEncodingAlgorithmsRe = regexp.MustCompile(`([a-z]{2,}|\*)`)

func init() {
	// TODO:
	// lzma: Opera.
	// sdch: Chrome, Android. Gzip output + dictionary header.
	// br:   Brotli.

	// TODO: Exception for old MSIE browsers that can't handle non-HTML?
	// https://zoompf.com/blog/2012/02/lose-the-wait-http-compression
	SetEncoder("gzip", encoderGzip)

	// HTTP 1.1 "deflate" (RFC 2616) stands for DEFLATE data (RFC 1951)
	// wrapped with zlib (RFC 1950). The zlib wrapper uses Adler-32
	// checksum compared to CRC-32 used in "gzip" and thus is faster.
	//
	// But.. some old browsers (MSIE, Safari 5.1) incorrectly expect
	// raw DEFLATE data only, without the mentioned zlib wrapper.
	// Because of this major confusion, most modern browsers try it
	// both ways, first looking for zlib headers.
	// Quote by Mark Adler: http://stackoverflow.com/a/9186091/385548
	//
	// The list of browsers having problems is quite big, see:
	// http://zoompf.com/blog/2012/02/lose-the-wait-http-compression
	// https://web.archive.org/web/20120321182910/http://www.vervestudios.co/projects/compression-tests/results
	//
	// That's why we prefer gzip over deflate. It's just more reliable
	// and not significantly slower than gzip.
	SetEncoder("deflate", encoderDeflate)

	// NOTE: Not implemented, intentionally:
	// case "compress": // LZW. Deprecated.
	// case "bzip2":    // Too slow on-the-fly.
	// case "zopfli":   // Too slow on-the-fly.
	// case "xz":       // Too slow on-the-fly.
}

// An EncoderFunc is a function that wraps the provided ResponseWriter with a
// streaming compression algorithm and returns it.
//
// In case of failure, the function should return nil.
type EncoderFunc func(w http.ResponseWriter, level int) io.Writer

// SetEncoder can be used to set the implementation of a compression algorithm.
//
// The encoding should be a standardised identifier. See:
// https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Accept-Encoding
//
// For example, add the Brotli algortithm:
//
//  import brotli_enc "gopkg.in/kothar/brotli-go.v0/enc"
//
//  middleware.SetEncoder("br", func(w http.ResponseWriter, level int) io.Writer {
//    params := brotli_enc.NewBrotliParams()
//    params.SetQuality(level)
//    return brotli_enc.NewBrotliWriter(params, w)
//  })
func SetEncoder(encoding string, fn EncoderFunc) {
	if encoding == "" {
		panic("the encoding can not be empty")
	}
	if fn == nil {
		panic("attempted to set a nil encoder function")
	}
	encoders[encoding] = fn
}

var defaultContentTypes = map[string]struct{}{
	"text/html":                {},
	"text/css":                 {},
	"text/plain":               {},
	"text/javascript":          {},
	"application/javascript":   {},
	"application/x-javascript": {},
	"application/json":         {},
	"application/atom+xml":     {},
	"application/rss+xml":      {},
	"image/svg+xml":            {},
}

// DefaultCompress is a middleware that compresses response
// body of predefined content types to a data format based
// on Accept-Encoding request header. It uses a default
// compression level.
func DefaultCompress(next http.Handler) http.Handler {
	return Compress(flate.DefaultCompression)(next)
}

// Compress is a middleware that compresses response
// body of a given content types to a data format based
// on Accept-Encoding request header. It uses a given
// compression level.
func Compress(level int, types ...string) func(next http.Handler) http.Handler {
	contentTypes := defaultContentTypes
	if len(types) > 0 {
		contentTypes = make(map[string]struct{}, len(types))
		for _, t := range types {
			contentTypes[t] = struct{}{}
		}
	}

	return func(next http.Handler) http.Handler {
		fn := func(w http.ResponseWriter, r *http.Request) {
			encoder, encoding := selectEncoder(r.Header)
			mcw := &maybeCompressResponseWriter{
				ResponseWriter: w,
				w:              w,
				contentTypes:   contentTypes,
				encoder:        encoder,
				encoding:       encoding,
				level:          level,
			}
			defer mcw.Close()

			next.ServeHTTP(mcw, r)
		}

		return http.HandlerFunc(fn)
	}
}

func selectEncoder(h http.Header) (EncoderFunc, string) {
	header := h.Get("Accept-Encoding")

	// Parse the names of all accepted algorithms from the header.
	var accepted []string
	for _, m := range acceptEncodingAlgorithmsRe.FindAllStringSubmatch(header, -1) {
		accepted = append(accepted, m[1])
	}

	sort.Sort(byPerformance(accepted))

	// Select the first mutually supported algorithm.
	for _, name := range accepted {
		if fn, ok := encoders[name]; ok {
			return fn, name
		}
	}
	return nil, ""
}

type byPerformance []string

func (l byPerformance) Len() int      { return len(l) }
func (l byPerformance) Swap(i, j int) { l[i], l[j] = l[j], l[i] }
func (l byPerformance) Less(i, j int) bool {
	// Higher number = higher preference. This causes unknown names, which map
	// to 0, to always be less prefered.
	scores := map[string]int{
		"br":      3,
		"gzip":    2,
		"deflate": 1,
	}
	return scores[l[i]] > scores[l[j]]
}

type maybeCompressResponseWriter struct {
	http.ResponseWriter
	w            io.Writer
	encoder      EncoderFunc
	encoding     string
	contentTypes map[string]struct{}
	level        int
	wroteHeader  bool
}

func (w *maybeCompressResponseWriter) WriteHeader(code int) {
	if w.wroteHeader {
		return
	}
	w.wroteHeader = true
	defer w.ResponseWriter.WriteHeader(code)

	// Already compressed data?
	if w.ResponseWriter.Header().Get("Content-Encoding") != "" {
		return
	}

	// Parse the first part of the Content-Type response header.
	contentType := ""
	parts := strings.Split(w.ResponseWriter.Header().Get("Content-Type"), ";")
	if len(parts) > 0 {
		contentType = parts[0]
	}

	// Is the content type compressable?
	if _, ok := w.contentTypes[contentType]; !ok {
		return
	}

	if w.encoder != nil && w.encoding != "" {
		if wr := w.encoder(w.ResponseWriter, w.level); wr != nil {
			w.w = wr
			w.Header().Set("Content-Encoding", w.encoding)
			// The content-length after compression is unknown
			w.Header().Del("Content-Length")
		}
	}
}

func (w *maybeCompressResponseWriter) Write(p []byte) (int, error) {
	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}

	return w.w.Write(p)
}

func (w *maybeCompressResponseWriter) Flush() {
	if f, ok := w.w.(http.Flusher); ok {
		f.Flush()
	}
}

func (w *maybeCompressResponseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	if hj, ok := w.w.(http.Hijacker); ok {
		return hj.Hijack()
	}
	return nil, nil, errors.New("chi/middleware: http.Hijacker is unavailable on the writer")
}

func (w *maybeCompressResponseWriter) CloseNotify() <-chan bool {
	if cn, ok := w.w.(http.CloseNotifier); ok {
		return cn.CloseNotify()
	}

	// If the underlying writer does not implement http.CloseNotifier, return
	// a channel that never receives a value. The semantics here is that the
	// client never disconnnects before the request is processed by the
	// http.Handler, which is close enough to the default behavior (when
	// CloseNotify() is not even called).
	return make(chan bool, 1)
}

func (w *maybeCompressResponseWriter) Close() error {
	if c, ok := w.w.(io.WriteCloser); ok {
		return c.Close()
	}
	return errors.New("chi/middleware: io.WriteCloser is unavailable on the writer")
}

func encoderGzip(w http.ResponseWriter, level int) io.Writer {
	gw, err := gzip.NewWriterLevel(w, level)
	if err != nil {
		return nil
	}
	return gw
}

func encoderDeflate(w http.ResponseWriter, level int) io.Writer {
	dw, err := flate.NewWriter(w, level)
	if err != nil {
		return nil
	}
	return dw
}
