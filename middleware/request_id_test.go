package middleware

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
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

func TestRequestIDStacked(t *testing.T) {
	for _, tt := range []struct {
		name      string
		header    string
		nilHeader bool
	}{
		{name: "generated"},
		{name: "incoming header", header: "incoming-id"},
		{name: "nil header", nilHeader: true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			if tt.nilHeader {
				req.Header = nil
			} else if tt.header != "" {
				req.Header.Set(RequestIDHeader, tt.header)
			}
			headers := req.Header.Clone()
			var first, second string
			handler := RequestID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				first = GetReqID(r.Context())
				RequestID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					second = GetReqID(r.Context())
				})).ServeHTTP(w, r)
			}))
			handler.ServeHTTP(httptest.NewRecorder(), req)
			if first == "" || first != second {
				t.Errorf("stacked RequestID changed ID: first %q, second %q", first, second)
			}
			if tt.header != "" && first != tt.header {
				t.Errorf("got request ID %q, want incoming header %q", first, tt.header)
			}
			if !reflect.DeepEqual(req.Header, headers) {
				t.Errorf("RequestID changed request headers: got %v, want %v", req.Header, headers)
			}
		})
	}
}

func TestRequestIDExistingContext(t *testing.T) {
	for _, tt := range []struct {
		name      string
		contextID string
		header    string
		want      string
	}{
		{name: "existing context", contextID: "context-id", want: "context-id"},
		{name: "context before header", contextID: "context-id", header: "header-id", want: "context-id"},
		{name: "empty context uses header", header: "header-id", want: "header-id"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			req = req.WithContext(context.WithValue(req.Context(), RequestIDKey, tt.contextID))
			if tt.header != "" {
				req.Header.Set(RequestIDHeader, tt.header)
			}
			headers := req.Header.Clone()
			var got string
			RequestID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				got = GetReqID(r.Context())
			})).ServeHTTP(httptest.NewRecorder(), req)
			if got != tt.want {
				t.Errorf("got request ID %q, want %q", got, tt.want)
			}
			if !reflect.DeepEqual(req.Header, headers) {
				t.Errorf("RequestID changed request headers: got %v, want %v", req.Header, headers)
			}
		})
	}
}
