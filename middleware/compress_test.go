package middleware

import (
	"compress/flate"
	"compress/gzip"
	"io"
	"io/ioutil"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi"
)

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

func TestOldAPI(t *testing.T) {
	r := chi.NewRouter()

	r.Use(Compress(5, "text/html"))

	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.Write([]byte("textstring"))
	})

	ts := httptest.NewServer(r)
	defer ts.Close()

	tests := []struct {
		name              string
		acceptedEncodings []string
		expectedEncoding  string
		extraCode         func()
	}{
		{
			name:              "no expected encodings",
			acceptedEncodings: nil,
			expectedEncoding:  "",
		},
		{
			name:              "gzip is only encoding",
			acceptedEncodings: []string{"gzip"},
			expectedEncoding:  "gzip",
		},
		{
			name:              "gzip is preferred over deflate",
			acceptedEncodings: []string{"gzip", "deflate"},
			expectedEncoding:  "gzip",
		},
		{
			name:              "deflate is used",
			acceptedEncodings: []string{"deflate"},
			expectedEncoding:  "deflate",
		},
		{
			name:              "deflate is preferred over gzip",
			acceptedEncodings: []string{"gzip, deflate"},
			expectedEncoding:  "deflate",
			extraCode: func() {
				SetEncoder("deflate", encoderDeflate)
			},
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			if tc.extraCode != nil {
				tc.extraCode()
			}
			resp, respString := testRequestWithAcceptedEncodings(t, ts, "GET", "/", tc.acceptedEncodings...)
			if respString != "textstring" {
				t.Errorf("response text doesn't match; expected:%q, got:%q", "textstring", respString)
			}
			if got := resp.Header.Get("Content-Encoding"); got != tc.expectedEncoding {
				t.Errorf("expected encoding %q but got %q", tc.expectedEncoding, got)
			}

		})

	}
}

func TestCompressor(t *testing.T) {
	r := chi.NewRouter()

	compressor := NewCompressor(5, "text/html", "text/css")
	if len(compressor.encoders) != 0 || len(compressor.pooledEncoders) != 2 {
		t.Errorf("gzip and deflate should be pooled")
	}

	compressor.SetEncoder("nop", func(w io.Writer, _ int) io.Writer {
		return w
	})

	if len(compressor.encoders) != 1 {
		t.Errorf("nop encoder should be stored in the encoders map")
	}

	r.Use(compressor.Handler())

	r.Get("/gethtml", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.Write([]byte("textstring"))
	})

	r.Get("/getcss", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.Write([]byte("textstring"))
	})

	r.Get("/getplain", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.Write([]byte("textstring"))
	})

	ts := httptest.NewServer(r)
	defer ts.Close()

	tests := []struct {
		name              string
		path              string
		acceptedEncodings []string
		expectedEncoding  string
	}{
		{
			name:              "no expected encodings due to no accepted encodings",
			path:              "/gethtml",
			acceptedEncodings: nil,
			expectedEncoding:  "",
		},
		{
			name:              "no expected encodings due to content type",
			path:              "/getplain",
			acceptedEncodings: nil,
			expectedEncoding:  "",
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
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			resp, respString := testRequestWithAcceptedEncodings(t, ts, "GET", tc.path, tc.acceptedEncodings...)
			if respString != "textstring" {
				t.Errorf("response text doesn't match; expected:%q, got:%q", "textstring", respString)
			}
			if got := resp.Header.Get("Content-Encoding"); got != tc.expectedEncoding {
				t.Errorf("expected encoding %q but got %q", tc.expectedEncoding, got)
			}

		})

	}
}
