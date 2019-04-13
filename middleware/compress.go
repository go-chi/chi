package middleware

import (
	"bufio"
	"compress/flate"
	"compress/gzip"
	"errors"
	"io"
	"io/ioutil"
	"net"
	"net/http"
	"strings"
	"sync"
)

var defaultCompressibleContentTypes = []string{
	"text/html",
	"text/css",
	"text/plain",
	"text/javascript",
	"application/javascript",
	"application/x-javascript",
	"application/json",
	"application/atom+xml",
	"application/rss+xml",
	"image/svg+xml",
}

// A default compressor that allows for the old API to use the new code.
// DEPRECATED
var defaultCompressor *Compressor

// Compressor represents a set of encoding configurations.
type Compressor struct {
	level int // The compression level.
	// The mapping of encoder names to encoder functions.
	encoders map[string]EncoderFunc
	// The mapping of pooled encoders to pools.
	pooledEncoders map[string]*sync.Pool
	// The set of content types allowed to be compressed.
	allowedTypes map[string]bool
	// The list of encoders in order of decreasing precedence.
	encodingPrecedence []string
}

// NewCompressor creates a new Compressor that will handle encoding responses.
//
// The level should be one of the ones defined in the flate package.
// The types are the content types that are allowed to be compressed.
func NewCompressor(level int, types ...string) *Compressor {
	// If types are provided, set those as the allowed types. If none are
	// provided, use the default list.
	allowedTypes := make(map[string]bool)
	if len(types) > 0 {
		for _, t := range types {
			allowedTypes[t] = true
		}
	} else {
		for _, t := range defaultCompressibleContentTypes {
			allowedTypes[t] = true
		}
	}

	c := &Compressor{
		level:          level,
		encoders:       make(map[string]EncoderFunc),
		pooledEncoders: make(map[string]*sync.Pool),
		allowedTypes:   allowedTypes,
	}
	// Set the default encoders.  The precedence order uses the reverse
	// ordering that the encoders were added. This means adding new encoders
	// will move them to the front of the order.
	//
	// TODO:
	// lzma: Opera.
	// sdch: Chrome, Android. Gzip output + dictionary header.
	// br:   Brotli, see https://github.com/go-chi/chi/pull/326

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
	c.SetEncoder("deflate", encoderDeflate)

	// TODO: Exception for old MSIE browsers that can't handle non-HTML?
	// https://zoompf.com/blog/2012/02/lose-the-wait-http-compression
	c.SetEncoder("gzip", encoderGzip)

	// NOTE: Not implemented, intentionally:
	// case "compress": // LZW. Deprecated.
	// case "bzip2":    // Too slow on-the-fly.
	// case "zopfli":   // Too slow on-the-fly.
	// case "xz":       // Too slow on-the-fly.
	return c
}

// SetEncoder can be used to set the implementation of a compression algorithm.
//
// The encoding should be a standardised identifier. See:
// https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Accept-Encoding
//
// For example, add the Brotli algortithm:
//
//  import brotli_enc "gopkg.in/kothar/brotli-go.v0/enc"
//
//  compressor := middleware.NewCompressor(5, "text/html")
//  compressor.SetEncoder("br", func(w http.ResponseWriter, level int) io.Writer {
//    params := brotli_enc.NewBrotliParams()
//    params.SetQuality(level)
//    return brotli_enc.NewBrotliWriter(params, w)
//  })
func (c *Compressor) SetEncoder(encoding string, fn EncoderFunc) {
	encoding = strings.ToLower(encoding)
	if encoding == "" {
		panic("the encoding can not be empty")
	}
	if fn == nil {
		panic("attempted to set a nil encoder function")
	}

	// If we are adding a new encoder that is already registered, we have to
	// clear that one out first.
	if _, ok := c.pooledEncoders[encoding]; ok {
		delete(c.pooledEncoders, encoding)
	}
	if _, ok := c.encoders[encoding]; ok {
		delete(c.encoders, encoding)
	}

	// If the encoder supports Resetting (IoReseterWriter), then it can be pooled.
	encoder := fn(ioutil.Discard, c.level)
	if encoder != nil {
		if _, ok := encoder.(ioResetterWriter); ok {
			pool := &sync.Pool{
				New: func() interface{} {
					return fn(ioutil.Discard, c.level)
				},
			}
			c.pooledEncoders[encoding] = pool
		}
	}
	// If the encoder is not in the pooledEncoders, add it to the normal encoders.
	if _, ok := c.pooledEncoders[encoding]; !ok {
		c.encoders[encoding] = fn
	}

	for i, v := range c.encodingPrecedence {
		if v == encoding {
			c.encodingPrecedence = append(c.encodingPrecedence[:i], c.encodingPrecedence[i+1:]...)
		}
	}

	c.encodingPrecedence = append([]string{encoding}, c.encodingPrecedence...)
}

// Handler returns a new middleware that will compress the response based on the
// current Compressor.
func (c *Compressor) Handler() func(next http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		fn := func(w http.ResponseWriter, r *http.Request) {
			encoder, encoding, cleanup := c.selectEncoder(r.Header, w)

			cw := &compressResponseWriter{
				ResponseWriter: w,
				w:              w,
				contentTypes:   c.allowedTypes,
				encoding:       encoding,
			}
			if encoder != nil {
				cw.w = encoder
			}
			// Re-add the encoder to the pool if applicable.
			defer cleanup()
			defer cw.Close()

			next.ServeHTTP(cw, r)
		}

		return http.HandlerFunc(fn)
	}

}

// selectEncoder returns the encoder, the name of the encoder, and a closer function.
func (c *Compressor) selectEncoder(h http.Header, w io.Writer) (io.Writer, string, func()) {
	header := h.Get("Accept-Encoding")

	// Parse the names of all accepted algorithms from the header.
	accepted := strings.Split(strings.ToLower(header), ",")

	// Find supported encoder by accepted list by precedence
	for _, name := range c.encodingPrecedence {
		if matchAcceptEncoding(accepted, name) {
			if pool, ok := c.pooledEncoders[name]; ok {
				encoder := pool.Get().(ioResetterWriter)
				cleanup := func() {
					pool.Put(encoder)
				}
				encoder.Reset(w)
				return encoder, name, cleanup

			}
			if fn, ok := c.encoders[name]; ok {
				return fn(w, c.level), name, func() {}
			}
		}

	}

	// No encoder found to match the accepted encoding
	return nil, "", func() {}
}

func matchAcceptEncoding(accepted []string, encoding string) bool {
	for _, v := range accepted {
		if strings.Contains(v, encoding) {
			return true
		}
	}
	return false
}

// An EncoderFunc is a function that wraps the provided io.Writer with a
// streaming compression algorithm and returns it.
//
// In case of failure, the function should return nil.
type EncoderFunc func(w io.Writer, level int) io.Writer

// Interface for types that allow resetting io.Writers.
type ioResetterWriter interface {
	io.Writer
	Reset(w io.Writer)
}

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
//
//  DEPRECATED
func SetEncoder(encoding string, fn EncoderFunc) {
	if defaultCompressor == nil {
		panic("no compressor to set encoders on. Call Compress() first")
	}
	defaultCompressor.SetEncoder(encoding, fn)
}

// DefaultCompress is a middleware that compresses response
// body of predefined content types to a data format based
// on Accept-Encoding request header. It uses a default
// compression level.
// DEPRECATED
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
//
// DEPRECATED
func Compress(level int, types ...string) func(next http.Handler) http.Handler {
	defaultCompressor = NewCompressor(level, types...)
	return defaultCompressor.Handler()
}

type compressResponseWriter struct {
	http.ResponseWriter
	// The streaming encoder writer to be used if there is one. Otherwise,
	// this is just the normal writer.
	w            io.Writer
	encoding     string
	contentTypes map[string]bool
	wroteHeader  bool
}

func (cw *compressResponseWriter) WriteHeader(code int) {
	if cw.wroteHeader {
		return
	}
	cw.wroteHeader = true
	defer cw.ResponseWriter.WriteHeader(code)

	// Already compressed data?
	if cw.Header().Get("Content-Encoding") != "" {
		return
	}

	// Parse the first part of the Content-Type response header.
	contentType := cw.Header().Get("Content-Type")
	if idx := strings.Index(contentType, ";"); idx >= 0 {
		contentType = contentType[0:idx]
	}

	// Is the content type compressable?
	if _, ok := cw.contentTypes[contentType]; !ok {
		return
	}

	if cw.encoding != "" {
		cw.Header().Set("Content-Encoding", cw.encoding)
		cw.Header().Set("Vary", "Accept-Encoding")

		// The content-length after compression is unknown
		cw.Header().Del("Content-Length")
	}
}

func (cw *compressResponseWriter) Write(p []byte) (int, error) {
	if !cw.wroteHeader {
		cw.WriteHeader(http.StatusOK)
	}

	return cw.w.Write(p)
}

func (cw *compressResponseWriter) Flush() {
	if f, ok := cw.w.(http.Flusher); ok {
		f.Flush()
	}
}

func (cw *compressResponseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	if hj, ok := cw.w.(http.Hijacker); ok {
		return hj.Hijack()
	}
	return nil, nil, errors.New("chi/middleware: http.Hijacker is unavailable on the writer")
}

func (cw *compressResponseWriter) Push(target string, opts *http.PushOptions) error {
	if ps, ok := cw.w.(http.Pusher); ok {
		return ps.Push(target, opts)
	}
	return errors.New("chi/middleware: http.Pusher is unavailable on the writer")
}

func (cw *compressResponseWriter) Close() error {
	if c, ok := cw.w.(io.WriteCloser); ok {
		return c.Close()
	}
	return errors.New("chi/middleware: io.WriteCloser is unavailable on the writer")
}

func encoderGzip(w io.Writer, level int) io.Writer {
	gw, err := gzip.NewWriterLevel(w, level)
	if err != nil {
		return nil
	}
	return gw
}

func encoderDeflate(w io.Writer, level int) io.Writer {
	dw, err := flate.NewWriter(w, level)
	if err != nil {
		return nil
	}
	return dw
}
