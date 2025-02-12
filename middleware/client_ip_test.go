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
