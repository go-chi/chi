package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi"
)

func TestXRequestId(t *testing.T) {
	req, _ := http.NewRequest("GET", "/", nil)
	req.Header.Add("X-Request-Id", "testing")
	w := httptest.NewRecorder()

	r := chi.NewRouter()
	// r.Use(RequestID)
	r.Use(ConfiguredRequestID("X-Request-Id"))

	requestID := ""
	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		requestID = GetReqID(r.Context())
		w.Write([]byte("Hello World"))
	})
	r.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Fatal("Response Code should be 200")
	}

	if requestID != "testing" {
		t.Fatal("Test copy existing requestID error.")
	}
}

func TestGenerateXRequestId(t *testing.T) {
	req, _ := http.NewRequest("GET", "/", nil)
	w := httptest.NewRecorder()

	r := chi.NewRouter()
	// r.Use(RequestID)
	r.Use(ConfiguredRequestID("X-Request-Id"))

	requestID := ""
	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		requestID = GetReqID(r.Context())
		w.Write([]byte("Hello World"))
	})
	r.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Fatal("Response Code should be 200")
	}

	if requestID == "" {
		t.Fatalf("Test generated requestID error. :%s", requestID)
	}
}

func TestCustomHeaderXRequestId(t *testing.T) {
	req, _ := http.NewRequest("GET", "/", nil)
	req.Header.Add("X-Custom-Request-Id", "testing")
	w := httptest.NewRecorder()

	r := chi.NewRouter()
	r.Use(ConfiguredRequestID("X-Custom-Request-Id"))

	requestID := ""
	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		requestID = GetReqID(r.Context())
		w.Write([]byte("Hello World"))
	})
	r.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Fatal("Response Code should be 200")
	}

	if requestID != "testing" {
		t.Fatalf("Test generated requestID error. :%s", requestID)
	}
}
