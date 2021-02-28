package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestXRealIP(t *testing.T) {
	req, _ := http.NewRequest("GET", "/", nil)
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
		t.Fatal("Test get real IP error.")
	}
}

func TestXForwardForIP(t *testing.T) {
	req, _ := http.NewRequest("GET", "/", nil)
	req.Header.Add("X-Forwarded-For", "100.100.100.100")
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
		t.Fatal("Test get real IP error.")
	}
}
