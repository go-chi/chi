package middleware

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

func maintainDefaultRequestID() func() {
	original := RequestIDHeader

	return func() {
		RequestIDHeader = original
	}
}

func TestRequestID(t *testing.T) {
	tests := map[string]struct {
		requestIDHeader  string
		request          func() *http.Request
		expectedResponse string
	}{
		"Retrieves Request Id from default header": {
			"X-Request-Id",
			func() *http.Request {
				req, _ := http.NewRequest("GET", "/", nil)
				req.Header.Add("X-Request-Id", "req-123456")

				return req
			},
			"RequestID: req-123456",
		},
		"Retrieves Request Id from custom header": {
			"X-Trace-Id",
			func() *http.Request {
				req, _ := http.NewRequest("GET", "/", nil)
				req.Header.Add("X-Trace-Id", "trace:abc123")

				return req
			},
			"RequestID: trace:abc123",
		},
	}

	defer maintainDefaultRequestID()()

	for _, test := range tests {
		w := httptest.NewRecorder()

		r := chi.NewRouter()

		RequestIDHeader = test.requestIDHeader

		r.Use(RequestID)

		r.Get("/", func(w http.ResponseWriter, r *http.Request) {
			requestID := GetReqID(r.Context())
			response := fmt.Sprintf("RequestID: %s", requestID)

			w.Write([]byte(response))
		})
		r.ServeHTTP(w, test.request())

		if w.Body.String() != test.expectedResponse {
			t.Fatalf("RequestID was not the expected value")
		}
	}
}

func TestRequestIDWithCustomKey(t *testing.T) {
	tests := map[string]struct {
		customKey   string
		request     func() *http.Request
		expectPanic bool
	}{
		"Sets request ID under custom key": {
			"x-custom-id",
			func() *http.Request {
				req, _ := http.NewRequest("GET", "/", nil)
				return req
			},
			false,
		},
		"Custom key value matches GetReqID": {
			"x-trace-id",
			func() *http.Request {
				req, _ := http.NewRequest("GET", "/", nil)
				return req
			},
			false,
		},
		"Panics on empty key": {
			"",
			func() *http.Request {
				req, _ := http.NewRequest("GET", "/", nil)
				return req
			},
			true,
		},
	}

	for name, test := range tests {
		t.Run(name, func(t *testing.T) {
			if test.expectPanic {
				defer func() {
					if r := recover(); r == nil {
						t.Fatalf("[%s] expected panic but did not get one", name)
					}
				}()
				RequestIDWithCustomKey(test.customKey)
				return
			}

			var gotDefault string
			var gotCustom string

			w := httptest.NewRecorder()

			r := chi.NewRouter()
			r.Use(RequestIDWithCustomKey(test.customKey))
			r.Get("/", func(w http.ResponseWriter, r *http.Request) {
				gotDefault = GetReqID(r.Context())
				if v, ok := r.Context().Value(test.customKey).(string); ok {
					gotCustom = v
				}
				w.Write([]byte(gotDefault))
			})
			r.ServeHTTP(w, test.request())

			if gotDefault == "" {
				t.Fatalf("[%s] expected default RequestIDKey to be set in context", name)
			}
			if gotCustom == "" {
				t.Fatalf("[%s] expected custom key %q to be set in context", name, test.customKey)
			}
			if gotDefault != gotCustom {
				t.Fatalf("[%s] default id %q and custom id %q should be equal", name, gotDefault, gotCustom)
			}
		})
	}
}
