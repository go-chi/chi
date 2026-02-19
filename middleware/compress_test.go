package middleware

import (
	"bytes"
	"compress/flate"
	"compress/gzip"
	"fmt"
	"io"
	"io/ioutil"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestCompressor(t *testing.T) {
	r := chi.NewRouter()

	compressor := NewCompressor(5, "text/html", "text/css")
	if len(compressor.encoders) != 0 || len(compressor.pooledEncoders) != 2 {
		t.Errorf("gzip and deflate should be pooled")
	}

	compressor.SetEncoder("nop", func(w io.Writer, _ int) io.Writer {
		return w
	})

	var sideEffect int
	compressor.SetEncoder("test", func(w io.Writer, _ int) io.Writer {
		return newSideEffectWriter(w, &sideEffect)
	})

	if len(compressor.encoders) != 2 {
		t.Errorf("nop and test encoders should be stored in the encoders map")
	}

	r.Use(compressor.Handler)

	r.Get("/gethtml", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.Write([]byte("textstring"))
	})

	r.Get("/getcss", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.Write([]byte("textstring"))
	})

	r.Get("/getplain", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		w.Write([]byte("textstring"))
	})

	r.Get("/getimage", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		w.Write([]byte("textstring"))
	})

	ts := httptest.NewServer(r)
	defer ts.Close()

	tests := []struct {
		name              string
		path              string
		expectedEncoding  string
		acceptedEncodings []string
		checkRawResponse  bool
	}{
		{
			name:              "no expected encodings due to no accepted encodings",
			path:              "/gethtml",
			acceptedEncodings: []string{""},
			expectedEncoding:  "",
			checkRawResponse:  true,
		},
		{
			name:              "no expected encodings due to content type",
			path:              "/getplain",
			acceptedEncodings: nil,
			expectedEncoding:  "",
			checkRawResponse:  true,
		},
		{
			name:              "gzip is only encoding",
			path:              "/gethtml",
			acceptedEncodings: []string{"gzip"},
			expectedEncoding:  "gzip",
		},
		{
			name:              "gzip is preferred over deflate",
			path:              "/getcss",
			acceptedEncodings: []string{"gzip", "deflate"},
			expectedEncoding:  "gzip",
		},
		{
			name:              "deflate is used",
			path:              "/getcss",
			acceptedEncodings: []string{"deflate"},
			expectedEncoding:  "deflate",
		},
		{

			name:              "nop is preferred",
			path:              "/getcss",
			acceptedEncodings: []string{"nop, gzip, deflate"},
			expectedEncoding:  "nop",
			checkRawResponse:  true,
		},
		{
			name:              "test encoder is used",
			path:              "/getimage",
			acceptedEncodings: []string{"test"},
			expectedEncoding:  "",
			checkRawResponse:  true,
		},
		{
			name:              "test encoder is used and Close is called",
			path:              "/gethtml",
			acceptedEncodings: []string{"test"},
			expectedEncoding:  "test",
			checkRawResponse:  true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if tc.checkRawResponse {
				testRequestRawResponse(t, ts, "GET", tc.path, []byte("textstring"), tc.acceptedEncodings...)
			}
			resp, respString := testRequestWithAcceptedEncodings(t, ts, "GET", tc.path, tc.acceptedEncodings...)
			if respString != "textstring" {
				t.Errorf("response text doesn't match; expected:%q, got:%q", "textstring", respString)
			}
			if got := resp.Header.Get("Content-Encoding"); got != tc.expectedEncoding {
				t.Errorf("expected encoding %q but got %q", tc.expectedEncoding, got)
			}

		})

	}
	if sideEffect != 0 {
		t.Errorf("side effect should be cleared after close")
	}
}

func TestCompressorWildcards(t *testing.T) {
	tests := []struct {
		name       string
		recover    string
		types      []string
		typesCount int
		wcCount    int
	}{
		{
			name:       "defaults",
			typesCount: 10,
		},
		{
			name:       "no wildcard",
			types:      []string{"text/plain", "text/html"},
			typesCount: 2,
		},
		{
			name:    "invalid wildcard #1",
			types:   []string{"audio/*wav"},
			recover: "middleware/compress: Unsupported content-type wildcard pattern 'audio/*wav'. Only '/*' supported",
		},
		{
			name:    "invalid wildcard #2",
			types:   []string{"application*/*"},
			recover: "middleware/compress: Unsupported content-type wildcard pattern 'application*/*'. Only '/*' supported",
		},
		{
			name:    "valid wildcard",
			types:   []string{"text/*"},
			wcCount: 1,
		},
		{
			name:       "mixed",
			types:      []string{"audio/wav", "text/*"},
			typesCount: 1,
			wcCount:    1,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			defer func() {
				if tt.recover == "" {
					tt.recover = "<nil>"
				}
				if r := recover(); tt.recover != fmt.Sprintf("%v", r) {
					t.Errorf("Unexpected value recovered: %v", r)
				}
			}()
			compressor := NewCompressor(5, tt.types...)
			if len(compressor.allowedTypes) != tt.typesCount {
				t.Errorf("expected %d allowedTypes, got %d", tt.typesCount, len(compressor.allowedTypes))
			}
			if len(compressor.allowedWildcards) != tt.wcCount {
				t.Errorf("expected %d allowedWildcards, got %d", tt.wcCount, len(compressor.allowedWildcards))
			}
		})
	}
}

func testRequestRawResponse(t *testing.T, ts *httptest.Server, method, path string, exp []byte, encodings ...string) {
	req, err := http.NewRequest(method, ts.URL+path, nil)
	if err != nil {
		t.Fatal(err)
		return
	}
	if len(encodings) > 0 {
		encodingsString := strings.Join(encodings, ",")
		req.Header.Set("Accept-Encoding", encodingsString)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
		return
	}

	respBody, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
		return
	}
	defer resp.Body.Close()

	if !bytes.Equal(respBody, exp) {
		t.Errorf("expected %q but got %q", exp, respBody)
	}
}

func testRequestWithAcceptedEncodings(t *testing.T, ts *httptest.Server, method, path string, encodings ...string) (*http.Response, string) {
	req, err := http.NewRequest(method, ts.URL+path, nil)
	if err != nil {
		t.Fatal(err)
		return nil, ""
	}
	if len(encodings) > 0 {
		encodingsString := strings.Join(encodings, ",")
		req.Header.Set("Accept-Encoding", encodingsString)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
		return nil, ""
	}

	respBody := decodeResponseBody(t, resp)
	defer resp.Body.Close()

	return resp, respBody
}

func decodeResponseBody(t *testing.T, resp *http.Response) string {
	var reader io.ReadCloser
	switch resp.Header.Get("Content-Encoding") {
	case "gzip":
		var err error
		reader, err = gzip.NewReader(resp.Body)
		if err != nil {
			t.Fatal(err)
		}
	case "deflate":
		reader = flate.NewReader(resp.Body)
	default:
		reader = resp.Body
	}
	respBody, err := ioutil.ReadAll(reader)
	if err != nil {
		t.Fatal(err)
		return ""
	}
	reader.Close()

	return string(respBody)
}

type (
	sideEffectWriter struct {
		w io.Writer
		s *int
	}
)

func newSideEffectWriter(w io.Writer, sideEffect *int) io.Writer {
	*sideEffect = *sideEffect + 1

	return &sideEffectWriter{w: w, s: sideEffect}
}

func (w *sideEffectWriter) Write(p []byte) (n int, err error) {
	return w.w.Write(p)
}

func (w *sideEffectWriter) Close() error {
	*w.s = *w.s - 1

	return nil
}
