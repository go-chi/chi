package middleware_test

import (
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"net/http/httptrace"
	"net/textproto"
	"reflect"
	"testing"

	"github.com/go-chi/chi/v5/middleware"
)

func TestCompressAfterInformationalResponse(t *testing.T) {
	for _, status := range []int{http.StatusContinue, http.StatusProcessing, http.StatusEarlyHints} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			server := httptest.NewServer(middleware.Compress(5)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Link", "</style.css>; rel=preload; as=style")
				w.WriteHeader(status)
				w.Header().Set("Content-Type", "text/plain")
				w.Header().Set("Content-Length", "12")
				w.WriteHeader(http.StatusCreated)
				_, _ = io.WriteString(w, "final answer")
			})))
			defer server.Close()

			var interim []int
			trace := &httptrace.ClientTrace{Got1xxResponse: func(code int, _ textproto.MIMEHeader) error {
				interim = append(interim, code)
				return nil
			}}
			req, err := http.NewRequest(http.MethodGet, server.URL, nil)
			if err != nil {
				t.Fatal(err)
			}
			req = req.WithContext(httptrace.WithClientTrace(req.Context(), trace))
			req.Header.Set("Accept-Encoding", "gzip")
			resp, err := server.Client().Do(req)
			if err != nil {
				t.Fatal(err)
			}
			defer resp.Body.Close()
			if resp.StatusCode != http.StatusCreated {
				t.Fatalf("status = %d", resp.StatusCode)
			}
			if !reflect.DeepEqual(interim, []int{status}) {
				t.Fatalf("interim responses = %v", interim)
			}
			if got := resp.Header.Get("Content-Encoding"); got != "gzip" {
				t.Fatalf("Content-Encoding = %q, want gzip", got)
			}
			body, err := gzip.NewReader(resp.Body)
			if err != nil {
				t.Fatal(err)
			}
			defer body.Close()
			data, err := io.ReadAll(body)
			if err != nil {
				t.Fatal(err)
			}
			if string(data) != "final answer" {
				t.Fatalf("body = %q", data)
			}
		})
	}
}
