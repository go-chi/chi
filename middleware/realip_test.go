package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestRealIP(t *testing.T) {
	tests := []struct {
		name       string
		remoteAddr string
		header     http.Header
		want       string
	}{
		{
			"remote-addr",
			"1.1.1.1:42",
			nil,
			"1.1.1.1:42",
		},
		{
			"x-real-ip",
			"1.1.1.1",
			http.Header{"X-Real-Ip": {"100.100.100.100"}},
			"100.100.100.100:0",
		},
		{
			"x-real-ip-6",
			"2001:beef::0",
			http.Header{"X-Real-Ip": {"2001:dead::0"}},
			"[2001:dead::0]:0",
		},
		{
			"x-forwarded-for",
			"1.1.1.1",
			http.Header{"X-Forwarded-For": {"100.100.100.100"}},
			"100.100.100.100:0",
		},
		{
			"x-forwarded-for-6",
			"2001:beef::0",
			http.Header{"X-Forwarded-For": {"2001:dead::0"}},
			"[2001:dead::0]:0",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req, _ := http.NewRequest("GET", "/", nil)
			req.RemoteAddr = tt.remoteAddr
			req.Header = tt.header

			w := httptest.NewRecorder()
			r := chi.NewRouter()
			r.Use(RealIP)

			realIP := ""
			r.Get("/", func(w http.ResponseWriter, r *http.Request) {
				realIP = r.RemoteAddr
				w.Write([]byte("Hello World"))
			})
			r.ServeHTTP(w, req)

			if w.Code != 200 {
				t.Fatalf("wrong response code: %d; wanted 200", w.Code)
			}

			if realIP != tt.want {
				t.Fatalf("wrong IP: %q; wanted %q", realIP, tt.want)
			}
		})
	}
}

func TestXForwardForXRealIPPrecedence(t *testing.T) {
	req, _ := http.NewRequest("GET", "/", nil)
	req.Header.Add("X-Forwarded-For", "0.0.0.0")
	req.Header.Add("X-Real-IP", "100.100.100.100")
	w := httptest.NewRecorder()

	r := chi.NewRouter()
	r.Use(RealIP)

	realIP := ""
	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		realIP = r.RemoteAddr
		w.Write([]byte("Hello World"))
	})
	r.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Fatal("Response Code should be 200")
	}

	if realIP != "100.100.100.100" {
		t.Fatal("Test get real IP precedence error.")
	}
}
