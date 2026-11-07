//go:build !tinygo

package middleware_test

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

func TestProfilerRedirectPreservesQuery(t *testing.T) {
	for _, mount := range []string{"/debug", "/private/debug", "/de%bug"} {
		t.Run(mount, func(t *testing.T) {
			r := chi.NewRouter()
			r.Mount(mount, middleware.Profiler())
			ts := httptest.NewServer(r)
			defer ts.Close()
			client := ts.Client()
			client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
			for _, suffix := range []string{"", "/", "/pprof"} {
				for _, query := range []string{"", "?debug=1&name=a%2Fb&name=c%20d"} {
					t.Run(suffix+query, func(t *testing.T) {
						path := strings.ReplaceAll(mount, "%", "%25")
						resp, err := client.Get(ts.URL + path + suffix + query)
						if err != nil {
							t.Fatal(err)
						}
						resp.Body.Close()
						want := path + "/pprof/" + query
						if resp.StatusCode != http.StatusMovedPermanently || resp.Header.Get("Location") != want {
							t.Fatalf("status=%d Location=%q, want 301 %q", resp.StatusCode, resp.Header.Get("Location"), want)
						}
						follow, err := client.Get(ts.URL + resp.Header.Get("Location"))
						if err != nil {
							t.Fatal(err)
						}
						body, err := io.ReadAll(follow.Body)
						follow.Body.Close()
						if err != nil {
							t.Fatal(err)
						}
						if follow.StatusCode != http.StatusOK || !strings.Contains(string(body), "Types of profiles available") {
							t.Fatalf("follow status=%d body=%q", follow.StatusCode, body)
						}
					})
				}
			}
		})
	}
}
