package middleware

import (
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestRequestSize(t *testing.T) {
	t.Parallel()

	const limit = 10

	var tests = []struct {
		name string
		body string
		want int
	}{
		{"should accept a body smaller than the limit", "short", http.StatusOK},
		{"should accept a body exactly at the limit", strings.Repeat("a", limit), http.StatusOK},
		{"should reject a body one byte over the limit", strings.Repeat("a", limit+1), http.StatusRequestEntityTooLarge},
		{"should accept an empty body", "", http.StatusOK},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			r := chi.NewRouter()
			r.Use(RequestSize(limit))
			r.Post("/", func(w http.ResponseWriter, r *http.Request) {
				b, err := io.ReadAll(r.Body)
				if err != nil {
					var maxErr *http.MaxBytesError
					if !errors.As(err, &maxErr) {
						t.Errorf("expected *http.MaxBytesError, got %T: %v", err, err)
					}
					w.WriteHeader(http.StatusRequestEntityTooLarge)
					return
				}
				if string(b) != tt.body {
					t.Errorf("got body %q, want %q", b, tt.body)
				}
				w.WriteHeader(http.StatusOK)
			})

			req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(tt.body))
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, req)

			if rec.Code != tt.want {
				t.Errorf("got status %d, want %d", rec.Code, tt.want)
			}
		})
	}
}
