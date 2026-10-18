package middleware

import (
	"compress/flate"
	"compress/gzip"
	"fmt"
	"io"
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

	if len(compressor.encoders) != 1 {
		t.Errorf("nop encoder should be stored in the encoders map")
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
		w.Header().Set("Content-Type", "text/html")
		w.Write([]byte("textstring"))
	})

	ts := httptest.NewServer(r)
	defer ts.Close()

	tests := []struct {
		name              string
		path              string
		expectedEncoding  string
		acceptedEncodings []string
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
		{
			name:              "gzip rejected with q=0 returns no encoding",
			path:              "/gethtml",
			acceptedEncodings: []string{"gzip;q=0"},
			expectedEncoding:  "",
		},
		{
			name:              "bgzip does not match gzip",
			path:              "/gethtml",
			acceptedEncodings: []string{"bgzip"},
			expectedEncoding:  "",
		},
		{
			name:              "deflate used when gzip rejected with q=0",
			path:              "/getcss",
			acceptedEncodings: []string{"gzip;q=0, deflate"},
			expectedEncoding:  "deflate",
		},
	}

	for _, tc := range tests {
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

func TestCompressorDefaultTextTypes(t *testing.T) {
	for _, contentType := range []string{"text/markdown", "text/csv", "text/vtt"} {
		t.Run(contentType, func(t *testing.T) {
			r := chi.NewRouter()
			r.Use(Compress(5))
			r.Get("/", func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", contentType)
				w.Write([]byte("textstring"))
			})

			ts := httptest.NewServer(r)
			defer ts.Close()

			resp, body := testRequestWithAcceptedEncodings(t, ts, "GET", "/", "gzip")
			if body != "textstring" {
				t.Errorf("response text doesn't match; expected:%q, got:%q", "textstring", body)
			}
			if got := resp.Header.Get("Content-Encoding"); got != "gzip" {
				t.Errorf("expected encoding %q but got %q", "gzip", got)
			}
		})
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
			typesCount: len(defaultCompressibleContentTypes),
		},
		{
			name:       "no wildcard",
			types:      []string{"text/plain", "text/html"},
			typesCount: 2,
		},
		{
			name:    "invalid wildcard #1",
			types:   []string{"audio/*wav"},
			recover: "middleware/compress: Unsupported content-type wildcard pattern 'audio/*wav'. Only '<type>/*' supported",
		},
		{
			name:    "invalid wildcard #2",
			types:   []string{"application*/*"},
			recover: "middleware/compress: Unsupported content-type wildcard pattern 'application*/*'. Only '<type>/*' supported",
		},
		{
			name:    "catch-all wildcard #1",
			types:   []string{"*/*"},
			recover: "middleware/compress: Unsupported content-type wildcard pattern '*/*'. Only '<type>/*' supported",
		},
		{
			name:    "catch-all wildcard #2",
			types:   []string{"/*"},
			recover: "middleware/compress: Unsupported content-type wildcard pattern '/*'. Only '<type>/*' supported",
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
	respBody, err := io.ReadAll(reader)
	if err != nil {
		t.Fatal(err)
		return ""
	}
	reader.Close()

	return string(respBody)
}

func TestMatchAcceptEncoding(t *testing.T) {
	tests := []struct {
		name     string
		accepted []string
		encoding string
		want     bool
	}{
		{
			name:     "exact match",
			accepted: []string{"gzip"},
			encoding: "gzip",
			want:     true,
		},
		{
			name:     "exact match deflate",
			accepted: []string{"deflate"},
			encoding: "deflate",
			want:     true,
		},
		{
			name:     "exact match identity",
			accepted: []string{"identity"},
			encoding: "identity",
			want:     true,
		},
		{
			name:     "substring prefix false positive br does not match b",
			accepted: []string{"br"},
			encoding: "b",
			want:     false,
		},
		{
			name:     "substring prefix false positive bgzip does not match gzip",
			accepted: []string{"bgzip"},
			encoding: "gzip",
			want:     false,
		},
		{
			name:     "substring suffix false positive gzipper does not match gzip",
			accepted: []string{"gzipper"},
			encoding: "gzip",
			want:     false,
		},
		{
			name:     "substring match zip does not match gzip",
			accepted: []string{"gzip"},
			encoding: "zip",
			want:     false,
		},
		{
			name:     "q=0 rejected",
			accepted: []string{"gzip;q=0"},
			encoding: "gzip",
			want:     false,
		},
		{
			name:     "q=0.0 rejected",
			accepted: []string{"gzip;q=0.0"},
			encoding: "gzip",
			want:     false,
		},
		{
			name:     "q=0.00 rejected",
			accepted: []string{"gzip;q=0.00"},
			encoding: "gzip",
			want:     false,
		},
		{
			name:     "q=0.000 rejected",
			accepted: []string{"gzip;q=0.000"},
			encoding: "gzip",
			want:     false,
		},
		{
			name:     "q=0 with whitespace before semicolon",
			accepted: []string{"gzip ; q=0"},
			encoding: "gzip",
			want:     false,
		},
		{
			name:     "q=0 with spaces around equal",
			accepted: []string{"gzip; q = 0"},
			encoding: "gzip",
			want:     false,
		},
		{
			name:     "uppercase Q=0 rejected",
			accepted: []string{"gzip;Q=0"},
			encoding: "gzip",
			want:     false,
		},
		{
			name:     "identity rejected with q=0",
			accepted: []string{"identity;q=0"},
			encoding: "identity",
			want:     false,
		},
		{
			name:     "identity accepted with positive q",
			accepted: []string{"identity;q=0.5"},
			encoding: "identity",
			want:     true,
		},
		{
			name:     "positive q=1 accepted",
			accepted: []string{"gzip;q=1"},
			encoding: "gzip",
			want:     true,
		},
		{
			name:     "positive q=1.0 accepted",
			accepted: []string{"gzip;q=1.0"},
			encoding: "gzip",
			want:     true,
		},
		{
			name:     "positive q=0.8 accepted",
			accepted: []string{"gzip;q=0.8"},
			encoding: "gzip",
			want:     true,
		},
		{
			name:     "positive q=0.5 accepted",
			accepted: []string{"gzip;q=0.5"},
			encoding: "gzip",
			want:     true,
		},
		{
			name:     "whitespace around token",
			accepted: []string{" gzip "},
			encoding: "gzip",
			want:     true,
		},
		{
			name:     "multiple encoders in slice first match",
			accepted: []string{"gzip", "deflate"},
			encoding: "gzip",
			want:     true,
		},
		{
			name:     "multiple encoders in slice second match",
			accepted: []string{"deflate", "gzip"},
			encoding: "gzip",
			want:     true,
		},
		{
			name:     "multiple encoders with rejected first match second",
			accepted: []string{"gzip;q=0", "deflate"},
			encoding: "deflate",
			want:     true,
		},
		{
			name:     "multiple encoders with rejected first queried for first",
			accepted: []string{"gzip;q=0", "deflate"},
			encoding: "gzip",
			want:     false,
		},
		{
			name:     "multiple encoders comma-separated in single element match second",
			accepted: []string{"gzip;q=0, deflate"},
			encoding: "deflate",
			want:     true,
		},
		{
			name:     "multiple encoders comma-separated in single element reject first",
			accepted: []string{"gzip;q=0, deflate"},
			encoding: "gzip",
			want:     false,
		},
		{
			name:     "case insensitive header token",
			accepted: []string{"GZIP"},
			encoding: "gzip",
			want:     true,
		},
		{
			name:     "case insensitive requested encoding",
			accepted: []string{"gzip"},
			encoding: "GZIP",
			want:     true,
		},
		{
			name:     "case insensitive mixed with q-value",
			accepted: []string{"GzIp;q=0.5"},
			encoding: "gzip",
			want:     true,
		},
		{
			name:     "multiple parameters with q=0 rejected",
			accepted: []string{"gzip;level=1;q=0"},
			encoding: "gzip",
			want:     false,
		},
		{
			name:     "multiple parameters with positive q accepted",
			accepted: []string{"gzip;level=1;q=0.8"},
			encoding: "gzip",
			want:     true,
		},
		{
			name:     "empty accepted string in slice",
			accepted: []string{""},
			encoding: "gzip",
			want:     false,
		},
		{
			name:     "empty accepted slice",
			accepted: []string{},
			encoding: "gzip",
			want:     false,
		},
		{
			name:     "empty target encoding",
			accepted: []string{"gzip"},
			encoding: "",
			want:     false,
		},
		{
			name:     "whitespace only accepted string",
			accepted: []string{"   "},
			encoding: "gzip",
			want:     false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := matchAcceptEncoding(tc.accepted, tc.encoding)
			if got != tc.want {
				t.Errorf("matchAcceptEncoding(%v, %q) = %v, want %v",
					tc.accepted, tc.encoding, got, tc.want)
			}
		})
	}
}
