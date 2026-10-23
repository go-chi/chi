package middleware

import (
	"bufio"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

// TestRouteHeadersHostRouteLiveServer is a regression test for a RouteHeaders
// Host route silently falling through to the default stack.
//
// net/http promotes an inbound Host header to r.Host and does not place it in
// r.Header, so a request built with httptest.NewRequest plus
// req.Header.Set("Host", ...) does NOT reproduce a server-parsed request. This
// test drives the middleware through a real net/http listener so the Host
// header is parsed the same way a production server parses it.
func TestRouteHeadersHostRouteLiveServer(t *testing.T) {
	var branch string

	hr := RouteHeaders().
		Route("Host", "admin.example.com", func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				branch = "ADMIN"
				next.ServeHTTP(w, r)
			})
		}).
		RouteDefault(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				branch = "PUBLIC"
				next.ServeHTTP(w, r)
			})
		})

	srv := httptest.NewServer(hr.Handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, branch)
	})))
	defer srv.Close()

	status, body := rawGet(t, srv.URL, "admin.example.com")
	if status != http.StatusOK {
		t.Fatalf("expected status 200, got %d", status)
	}
	if body != "ADMIN" {
		t.Errorf("Host route with Host: admin.example.com should select ADMIN middleware, got %q", body)
	}

	// A host that matches no Host route must still use the default stack.
	status, body = rawGet(t, srv.URL, "other.example.com")
	if status != http.StatusOK {
		t.Fatalf("expected status 200, got %d", status)
	}
	if body != "PUBLIC" {
		t.Errorf("unmatched host should fall through to the default stack, got %q", body)
	}
}

// rawGet issues a bare HTTP/1.1 request with an explicit Host header, without
// going through any client that would rewrite the Host value.
func rawGet(t *testing.T, baseURL, host string) (int, string) {
	t.Helper()

	u, err := url.Parse(baseURL)
	if err != nil {
		t.Fatalf("parse url: %v", err)
	}
	conn, err := net.Dial("tcp", u.Host)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	req := fmt.Sprintf("GET / HTTP/1.1\r\nHost: %s\r\nConnection: close\r\n\r\n", host)
	if _, err := io.WriteString(conn, req); err != nil {
		t.Fatalf("write: %v", err)
	}

	resp, err := http.ReadResponse(bufio.NewReader(conn), nil)
	if err != nil {
		t.Fatalf("read response: %v", err)
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	return resp.StatusCode, string(data)
}
