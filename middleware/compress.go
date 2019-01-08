package middleware

import (
	"bufio"
	"compress/flate"
	"compress/gzip"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
)

var encoders = map[string]EncoderFunc{}

var encodingPrecedence = []string{"br", "gzip", "deflate"}

func init() {
	// TODO:
	// lzma: Opera.
	// sdch: Chrome, Android. Gzip output + dictionary header.
	// br:   Brotli, see https://github.com/go-chi/chi/pull/326

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
	encoding = strings.ToLower(encoding)
	if encoding == "" {
		panic("the encoding can not be empty")
	}
	if fn == nil {
		panic("attempted to set a nil encoder function")
	}
	encoders[encoding] = fn

	var e string
	for _, v := range encodingPrecedence {
		if v == encoding {
			e = v
		}
	}

	if e == "" {
		encodingPrecedence = append([]string{e}, encodingPrecedence...)
	}
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
//
// NOTE: make sure to set the Content-Type header on your response
// otherwise this middleware will not compress the response body. For ex, in
// your handler you should set w.Header().Set("Content-Type", http.DetectContentType(yourBody))
// or set it manually.
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

			cw := &compressResponseWriter{
				ResponseWriter: w,
				w:              w,
				contentTypes:   contentTypes,
				encoder:        encoder,
				encoding:       encoding,
				level:          level,
			}
			defer cw.Close()

			next.ServeHTTP(cw, r)
		}

		return http.HandlerFunc(fn)
	}
}

func selectEncoder(h http.Header) (EncoderFunc, string) {
	header := h.Get("Accept-Encoding")

	// Parse the names of all accepted algorithms from the header.
	accepted := strings.Split(strings.ToLower(header), ",")

	// Find supported encoder by accepted list by precedence
	for _, name := range encodingPrecedence {
		if fn, ok := encoders[name]; ok && matchAcceptEncoding(accepted, name) {
			return fn, name
		}
	}

	// No encoder found to match the accepted encoding
	return nil, ""
}

func matchAcceptEncoding(accepted []string, encoding string) bool {
	for _, v := range accepted {
		if strings.Index(v, encoding) >= 0 {
			return true
		}
	}
	return false
}

type compressResponseWriter struct {
	http.ResponseWriter
	w            io.Writer
	encoder      EncoderFunc
	encoding     string
	contentTypes map[string]struct{}
	level        int
	wroteHeader  bool
}

func (w *compressResponseWriter) WriteHeader(code int) {
	if w.wroteHeader {
		return
	}
	w.wroteHeader = true
	defer w.WriteHeader(code)

	// Already compressed data?
	if w.Header().Get("Content-Encoding") != "" {
		return
	}

	// Parse the first part of the Content-Type response header.
	contentType := ""
	parts := strings.Split(w.Header().Get("Content-Type"), ";")
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

func (w *compressResponseWriter) Write(p []byte) (int, error) {
	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}

	return w.w.Write(p)
}

func (w *compressResponseWriter) Flush() {
	if f, ok := w.w.(http.Flusher); ok {
		f.Flush()
	}
}

func (w *compressResponseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	if hj, ok := w.w.(http.Hijacker); ok {
		return hj.Hijack()
	}
	return nil, nil, errors.New("chi/middleware: http.Hijacker is unavailable on the writer")
}

func (w *compressResponseWriter) Push(target string, opts *http.PushOptions) error {
	if ps, ok := w.w.(http.Pusher); ok {
		return ps.Push(target, opts)
	}
	return errors.New("chi/middleware: http.Pusher is unavailable on the writer")
}

func (w *compressResponseWriter) Close() error {
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
