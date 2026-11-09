package middleware

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestContentType(t *testing.T) {
	t.Parallel()

	var tests = []struct {
		name                string
		inputValue          string
		allowedContentTypes []string
		want                int
	}{
		{
			"should accept requests with a matching content type",
			"application/json; charset=UTF-8",
			[]string{"application/json"},
			http.StatusOK,
		},
		{
			"should accept requests with a matching content type no charset",
			"application/json",
			[]string{"application/json"},
			http.StatusOK,
		},
		{
			"should accept requests with a matching content-type with extra values",
			"application/json; foo=bar; charset=UTF-8; spam=eggs",
			[]string{"application/json"},
			http.StatusOK,
		},
		{
			"should accept requests with a matching content type when multiple content types are supported",
			"text/xml; charset=UTF-8",
			[]string{"application/json", "text/xml"},
			http.StatusOK,
		},
		{
			"should not accept requests with a mismatching content type",
			"text/plain; charset=latin-1",
			[]string{"application/json"},
			http.StatusUnsupportedMediaType,
		},
		{
			"should not accept requests with a mismatching content type even if multiple content types are allowed",
			"text/plain; charset=Latin-1",
			[]string{"application/json", "text/xml"},
			http.StatusUnsupportedMediaType,
		},
	}

	for _, tt := range tests {
		var tt = tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			recorder := httptest.NewRecorder()

			r := chi.NewRouter()
			r.Use(AllowContentType(tt.allowedContentTypes...))
			r.Post("/", func(w http.ResponseWriter, r *http.Request) {})

			body := []byte("This is my content. There are many like this but this one is mine")
			req := httptest.NewRequest("POST", "/", bytes.NewReader(body))
			req.Header.Set("Content-Type", tt.inputValue)

			r.ServeHTTP(recorder, req)
			res := recorder.Result()

			if res.StatusCode != tt.want {
				t.Errorf("response is incorrect, got %d, want %d", recorder.Code, tt.want)
			}
		})
	}
}

func TestSetHeader(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		headers    [][2]string
		wantHeader map[string]string
	}{
		{
			name: "single response header",
			headers: [][2]string{
				{"X-Custom-Header", "my-value"},
			},
			wantHeader: map[string]string{
				"X-Custom-Header": "my-value",
			},
		},
		{
			name: "multiple chained headers",
			headers: [][2]string{
				{"X-Service-Name", "api-gateway"},
				{"X-Environment", "production"},
			},
			wantHeader: map[string]string{
				"X-Service-Name": "api-gateway",
				"X-Environment":  "production",
			},
		},
		{
			name: "override existing header value",
			headers: [][2]string{
				{"X-Version", "v1"},
				{"X-Version", "v2"},
			},
			wantHeader: map[string]string{
				"X-Version": "v2",
			},
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			r := chi.NewRouter()
			for _, h := range tt.headers {
				r.Use(SetHeader(h[0], h[1]))
			}

			handlerExecuted := false
			r.Get("/test", func(w http.ResponseWriter, r *http.Request) {
				handlerExecuted = true
				w.WriteHeader(http.StatusOK)
				w.Write([]byte("ok"))
			})

			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/test", nil)
			r.ServeHTTP(rec, req)

			if !handlerExecuted {
				t.Errorf("expected inner handler to be executed")
			}

			if rec.Code != http.StatusOK {
				t.Errorf("status code = %d, want %d", rec.Code, http.StatusOK)
			}

			if rec.Body.String() != "ok" {
				t.Errorf("body = %q, want %q", rec.Body.String(), "ok")
			}

			for k, want := range tt.wantHeader {
				if got := rec.Header().Get(k); got != want {
					t.Errorf("header %q = %q, want %q", k, got, want)
				}
			}
		})
	}
}
