package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRouteHeadersHostHeader(t *testing.T) {
	// Test that the Host header is properly read from r.Host
	// since Go's http server promotes it there and removes it from Header map

	mainHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("main"))
	})

	subdomainHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("subdomain"))
	})

	// Create the route headers middleware
	hr := RouteHeaders().
		Route("Host", "*.example.com", func(next http.Handler) http.Handler {
			return subdomainHandler
		}).
		Handler(mainHandler)

	tests := []struct {
		name     string
		host     string
		expected string
	}{
		{
			name:     "subdomain match",
			host:     "sub.example.com",
			expected: "subdomain",
		},
		{
			name:     "main domain no match",
			host:     "example.com",
			expected: "main",
		},
		{
			name:     "other domain no match",
			host:     "other.com",
			expected: "main",
		},
		{
			name:     "nested subdomain match",
			host:     "deep.sub.example.com",
			expected: "subdomain",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/", nil)
			req.Host = tt.host

			rec := httptest.NewRecorder()
			hr.ServeHTTP(rec, req)

			if rec.Body.String() != tt.expected {
				t.Errorf("expected %q, got %q", tt.expected, rec.Body.String())
			}
		})
	}
}

func TestRouteHeadersHostHeaderWithPort(t *testing.T) {
	// Test that Host header with port is handled correctly

	mainHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("main"))
	})

	subdomainHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("subdomain"))
	})

	hr := RouteHeaders().
		Route("Host", "*.example.com:8080", func(next http.Handler) http.Handler {
			return subdomainHandler
		}).
		Handler(mainHandler)

	tests := []struct {
		name     string
		host     string
		expected string
	}{
		{
			name:     "subdomain with port match",
			host:     "sub.example.com:8080",
			expected: "subdomain",
		},
		{
			name:     "subdomain without port no match",
			host:     "sub.example.com",
			expected: "main",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/", nil)
			req.Host = tt.host

			rec := httptest.NewRecorder()
			hr.ServeHTTP(rec, req)

			if rec.Body.String() != tt.expected {
				t.Errorf("expected %q, got %q", tt.expected, rec.Body.String())
			}
		})
	}
}

func TestRouteHeadersRegularHeader(t *testing.T) {
	// Test that regular headers (not Host) still work from r.Header

	defaultHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("default"))
	})

	matchedHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("matched"))
	})

	hr := RouteHeaders().
		Route("X-Custom-Header", "special-value", func(next http.Handler) http.Handler {
			return matchedHandler
		}).
		Handler(defaultHandler)

	tests := []struct {
		name        string
		headerKey   string
		headerValue string
		expected    string
	}{
		{
			name:        "matching header",
			headerKey:   "X-Custom-Header",
			headerValue: "special-value",
			expected:    "matched",
		},
		{
			name:        "non-matching header value",
			headerKey:   "X-Custom-Header",
			headerValue: "other-value",
			expected:    "default",
		},
		{
			name:        "missing header",
			headerKey:   "",
			headerValue: "",
			expected:    "default",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/", nil)
			if tt.headerKey != "" {
				req.Header.Set(tt.headerKey, tt.headerValue)
			}

			rec := httptest.NewRecorder()
			hr.ServeHTTP(rec, req)

			if rec.Body.String() != tt.expected {
				t.Errorf("expected %q, got %q", tt.expected, rec.Body.String())
			}
		})
	}
}
