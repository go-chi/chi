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
)

func TestCompressorFlushBeforeWrite(t *testing.T) {
	for _, encoding := range []string{"gzip", "deflate", "identity"} {
		for _, contentType := range []string{"text/plain", "image/png"} {
			for _, explicitStatus := range []bool{false, true} {
				t.Run(fmt.Sprintf("%s/%s/explicit-%t", encoding, contentType, explicitStatus), func(t *testing.T) {
					handler := Compress(5)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						w.Header().Set("Content-Type", contentType)
						if explicitStatus {
							w.WriteHeader(http.StatusCreated)
						}
						w.(http.Flusher).Flush()
						w.(http.Flusher).Flush()
						if _, err := io.WriteString(w, "first chunk"); err != nil {
							t.Error(err)
						}
						w.(http.Flusher).Flush()
						if _, err := io.WriteString(w, " second chunk"); err != nil {
							t.Error(err)
						}
					}))
					server := httptest.NewServer(handler)
					defer server.Close()
					req, err := http.NewRequest(http.MethodGet, server.URL, nil)
					if err != nil {
						t.Fatal(err)
					}
					req.Header.Set("Accept-Encoding", encoding)
					resp, err := server.Client().Do(req)
					if err != nil {
						t.Fatal(err)
					}
					defer resp.Body.Close()
					wantStatus := http.StatusOK
					if explicitStatus {
						wantStatus = http.StatusCreated
					}
					if resp.StatusCode != wantStatus {
						t.Errorf("status = %d, want %d", resp.StatusCode, wantStatus)
					}
					wantEncoding := ""
					if contentType == "text/plain" && encoding != "identity" {
						wantEncoding = encoding
					}
					if got := resp.Header.Get("Content-Encoding"); got != wantEncoding {
						t.Errorf("Content-Encoding = %q, want %q", got, wantEncoding)
					}
					var reader io.Reader = resp.Body
					switch wantEncoding {
					case "gzip":
						gz, err := gzip.NewReader(resp.Body)
						if err != nil {
							t.Fatal(err)
						}
						defer gz.Close()
						reader = gz
					case "deflate":
						fl := flate.NewReader(resp.Body)
						defer fl.Close()
						reader = fl
					}
					body, err := io.ReadAll(reader)
					if err != nil {
						t.Fatal(err)
					}
					if string(body) != "first chunk second chunk" {
						t.Errorf("body = %q", body)
					}
					if wantEncoding != "" && !strings.Contains(resp.Header.Get("Vary"), "Accept-Encoding") {
						t.Errorf("missing Vary: Accept-Encoding")
					}
				})
			}
		}
	}
}
