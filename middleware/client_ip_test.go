package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestClientIPFromHeader(t *testing.T) {
	tt := []struct {
		name string
		in   string
		out  string
	}{
		// Empty header.
		{name: "empty", in: "", out: ""},

		// Valid X-Real-IP header values.
		{name: "valid_ipv4", in: "100.100.100.100", out: "100.100.100.100"},
		{name: "valid_ipv4", in: "178.25.203.2", out: "178.25.203.2"},
		{name: "valid_ipv6_lower", in: "2345:0425:2ca1:0000:0000:0567:5673:23b5", out: "2345:425:2ca1::567:5673:23b5"},
		{name: "valid_ipv6_upper", in: "2345:0425:2CA1:0000:0000:0567:5673:23B5", out: "2345:425:2ca1::567:5673:23b5"},
		{name: "valid_ipv6_lower_short", in: "2345:425:2ca1::567:5673:23b5", out: "2345:425:2ca1::567:5673:23b5"},
		{name: "valid_ipv6_upper_short", in: "2345:425:2CA1::567:5673:23B5", out: "2345:425:2ca1::567:5673:23b5"},

		// Invalid X-Real-IP header values.
		{name: "invalid_ip", in: "invalid", out: ""},
		{name: "invalid_ip_with_port", in: "100.100.100.100:80", out: ""},
		{name: "invalid_multiple_ips", in: "100.100.100.100;100.100.100.101;100.100.100.102", out: ""},
		{name: "invalid_loopback", in: "127.0.0.1", out: ""},
		{name: "invalid_zeroes", in: "0.0.0.0", out: ""},
		{name: "invalid_loopback", in: "127.0.0.1", out: ""},
		{name: "invalid_private_ipv4_1", in: "192.168.0.1", out: ""},
		{name: "invalid_private_ipv4_2", in: "192.168.10.12", out: ""},
		{name: "invalid_private_ipv4_3", in: "172.16.0.0", out: ""},
		{name: "invalid_private_ipv4_4", in: "172.25.203.2", out: ""},
		{name: "invalid_private_ipv4_5", in: "10.0.0.0", out: ""},
		{name: "invalid_private_ipv4_6", in: "10.0.1.10", out: ""},
		{name: "invalid_private_ipv6_1", in: "fc00::1", out: ""},
		{name: "invalid_private_ipv6_2", in: "fc00:0425:2ca1:0000:0000:0567:5673:23b5", out: ""},
	}

	for _, tc := range tt {
		t.Run(tc.name, func(t *testing.T) {
			req, _ := http.NewRequest("GET", "/", nil)
			req.Header.Add("X-Real-IP", tc.in)
			w := httptest.NewRecorder()

			r := chi.NewRouter()
			r.Use(ClientIPFromHeader("X-Real-IP"))

			var clientIP string
			r.Get("/", func(w http.ResponseWriter, r *http.Request) {
				clientIP = GetClientIP(r.Context())
				w.Write([]byte("Hello World"))
			})
			r.ServeHTTP(w, req)

			if w.Code != 200 {
				t.Errorf("Response Code should be 200")
			}

			if clientIP != tc.out {
				t.Errorf("expected %v, got %v", tc.out, clientIP)
			}
		})
	}
}

func TestClientIPFromXFFHeader(t *testing.T) {
	tt := []struct {
		name string
		xff  []string
		out  string
	}{
		{name: "empty", xff: []string{""}, out: ""},

		{name: "", xff: []string{"100.100.100.100"}, out: "100.100.100.100"},
		{name: "", xff: []string{"100.100.100.100, 200.200.200.200"}, out: "200.200.200.200"},
		{name: "", xff: []string{"100.100.100.100,200.200.200.200"}, out: "200.200.200.200"},
		{name: "", xff: []string{"100.100.100.100", "200.200.200.200"}, out: "200.200.200.200"},
		{name: "", xff: []string{"2001:db8:85a3:8d3:1319:8a2e:370:7348"}, out: "2001:db8:85a3:8d3:1319:8a2e:370:7348"},
		{name: "", xff: []string{"203.0.113.195, 2001:db8:85a3:8d3:1319:8a2e:370:7348"}, out: "2001:db8:85a3:8d3:1319:8a2e:370:7348"},
		{name: "", xff: []string{"5.5.5.5, 203.0.113.195, 2001:db8:85a3:8d3:1319:8a2e:370:7348", "7.7.7.7, 4.4.4.4"}, out: "4.4.4.4"},
	}

	r := chi.NewRouter()
	r.Use(ClientIPFromXFFHeader())

	for _, tc := range tt {
		req, _ := http.NewRequest("GET", "/", nil)
		for _, v := range tc.xff {
			req.Header.Add("X-Forwarded-For", v)
		}

		w := httptest.NewRecorder()

		clientIP := ""
		r.Get("/", func(w http.ResponseWriter, r *http.Request) {
			clientIP = GetClientIP(r.Context())
			w.Write([]byte("Hello World"))
		})
		r.ServeHTTP(w, req)

		if w.Code != 200 {
			t.Errorf("Response Code should be 200")
		}

		if clientIP != tc.out {
			t.Errorf("expected %v, got %v", tc.out, clientIP)
		}
	}
}

func TestClientIPFromXFFHeaderWithTrustedPrefixes(t *testing.T) {
	tt := []struct {
		name            string
		trustedPrefixes []string
		xff             []string
		out             string
	}{
		// XFF: client → trusted proxy. Skips the trusted proxy and returns the client IP.
		{
			name:            "single_trusted_proxy",
			trustedPrefixes: []string{"203.0.113.0/24"},
			xff:             []string{"100.100.100.100, 203.0.113.1"},
			out:             "100.100.100.100",
		},
		// XFF: client → trusted proxy1 → trusted proxy2. Both trusted hops are skipped.
		{
			name:            "multiple_trusted_proxies_chain",
			trustedPrefixes: []string{"203.0.113.0/24", "198.51.100.0/24"},
			xff:             []string{"100.100.100.100, 203.0.113.1, 198.51.100.5"},
			out:             "100.100.100.100",
		},
		// XFF: fake_ip, real_client, trusted_proxy.
		// An attacker prepending a forged IP is foiled because the right-to-left traversal
		// skips the trusted proxy and stops at real_client, never reaching fake_ip.
		{
			name:            "spoofing_attempt_ignored",
			trustedPrefixes: []string{"203.0.113.0/24"},
			xff:             []string{"1.2.3.4, 100.100.100.100, 203.0.113.1"},
			out:             "100.100.100.100",
		},
		// Every IP in XFF falls within the trusted range; no client IP can be determined.
		{
			name:            "all_trusted_returns_empty",
			trustedPrefixes: []string{"203.0.113.0/24"},
			xff:             []string{"203.0.113.2, 203.0.113.1"},
			out:             "",
		},
		// The first address of a /24 (.0) is inside the trusted range and must be skipped.
		{
			name:            "trusted_prefix_boundary_first_addr",
			trustedPrefixes: []string{"203.0.113.0/24"},
			xff:             []string{"100.100.100.100, 203.0.113.0"},
			out:             "100.100.100.100",
		},
		// The last address of a /24 (.255) is inside the trusted range and must be skipped.
		{
			name:            "trusted_prefix_boundary_last_addr",
			trustedPrefixes: []string{"203.0.113.0/24"},
			xff:             []string{"100.100.100.100, 203.0.113.255"},
			out:             "100.100.100.100",
		},
		// An IP just outside the trusted prefix (203.0.114.x) is not trusted and is
		// returned as the client IP.
		{
			name:            "ip_just_outside_trusted_prefix_is_client",
			trustedPrefixes: []string{"203.0.113.0/24"},
			xff:             []string{"203.0.114.1, 203.0.113.1"},
			out:             "203.0.114.1",
		},
		// With no trusted prefixes configured, the rightmost public IP is returned as-is.
		{
			name:            "no_trusted_prefixes_rightmost_public",
			trustedPrefixes: []string{},
			xff:             []string{"100.100.100.100, 200.200.200.200"},
			out:             "200.200.200.200",
		},
	}

	for _, tc := range tt {
		t.Run(tc.name, func(t *testing.T) {
			req, _ := http.NewRequest("GET", "/", nil)
			for _, v := range tc.xff {
				req.Header.Add("X-Forwarded-For", v)
			}

			w := httptest.NewRecorder()

			r := chi.NewRouter()
			r.Use(ClientIPFromXFFHeader(tc.trustedPrefixes...))

			var clientIP string
			r.Get("/", func(w http.ResponseWriter, r *http.Request) {
				clientIP = GetClientIP(r.Context())
				w.Write([]byte("Hello World"))
			})
			r.ServeHTTP(w, req)

			if w.Code != 200 {
				t.Errorf("Response Code should be 200")
			}

			if clientIP != tc.out {
				t.Errorf("expected %v, got %v", tc.out, clientIP)
			}
		})
	}
}

func TestClientIPFromRemoteAddr(t *testing.T) {
	req, _ := http.NewRequest("GET", "/", nil)
	req.RemoteAddr = "192.0.2.1:1234" // Simulate the remote address set by http.Server.

	w := httptest.NewRecorder()

	r := chi.NewRouter()
	r.Use(ClientIPFromRemoteAddr)

	var clientIP string
	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		clientIP = GetClientIP(r.Context())
		w.Write([]byte("Hello World"))
	})
	r.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Errorf("Response Code should be 200")
	}

	expected := "192.0.2.1"
	if clientIP != expected {
		t.Errorf("expected %v, got %v", expected, clientIP)
	}
}
