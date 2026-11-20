package middleware

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync/atomic"
	"testing"
)

func TestRouteHeadersPreservesMiddlewareState(t *testing.T) {
	for _, mode := range []string{"route", "any", "default", "direct", "unmatched"} {
		t.Run(mode, func(t *testing.T) {
			countRequests := func(next http.Handler) http.Handler {
				var count atomic.Int64
				return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.Header().Set("X-Request-Count", strconv.FormatInt(count.Add(1), 10))
					next.ServeHTTP(w, r)
				})
			}
			next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusNoContent)
			})
			var handler http.Handler
			switch mode {
			case "route":
				handler = RouteHeaders().Route("X-Region", "eu", countRequests).Handler(next)
			case "any":
				handler = RouteHeaders().RouteAny("X-Region", []string{"eu", "us"}, countRequests).Handler(next)
			case "default":
				handler = RouteHeaders().RouteDefault(countRequests).Handler(next)
			case "direct":
				handler = countRequests(next)
			case "unmatched":
				handler = RouteHeaders().Route("X-Region", "us", countRequests).Handler(next)
			}
			server := httptest.NewServer(handler)
			defer server.Close()
			for i := 1; i <= 3; i++ {
				req, err := http.NewRequest(http.MethodGet, server.URL, nil)
				if err != nil {
					t.Fatal(err)
				}
				req.Header.Set("X-Region", "eu")
				resp, err := server.Client().Do(req)
				if err != nil {
					t.Fatal(err)
				}
				resp.Body.Close()
				want := strconv.Itoa(i)
				if mode == "unmatched" {
					want = ""
				}
				if got := resp.Header.Get("X-Request-Count"); got != want {
					t.Fatalf("request %d: counter = %q, want %q", i, got, want)
				}
				if resp.StatusCode != http.StatusNoContent {
					t.Fatalf("status = %d", resp.StatusCode)
				}
			}
		})
	}
}
