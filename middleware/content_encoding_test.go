package middleware

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestContentEncodingMiddleware(t *testing.T) {
	t.Parallel()

	// support for:
	// Content-Encoding: gzip
	// Content-Encoding: deflate
	// Content-Encoding: gzip, deflate   (comma-separated single header)
	// Content-Encoding: gzip + Content-Encoding: deflate (multi header)
	middleware := AllowContentEncoding("deflate", "gzip")

	tests := []struct {
		name           string
		// set as single comma-joined Content-Encoding value when joinComma is true
		encodings      []string
		joinComma      bool
		useAdd         bool // Add each encoding as separate header
		expectedStatus int
	}{
		{
			name:           "Support no encoding",
			encodings:      []string{},
			expectedStatus: 200,
		},
		{
			name:           "Support gzip encoding",
			encodings:      []string{"gzip"},
			expectedStatus: 200,
		},
		{
			name:           "No support for br encoding",
			encodings:      []string{"br"},
			expectedStatus: 415,
		},
		{
			name:           "Support for gzip and deflate via separate headers",
			encodings:      []string{"gzip", "deflate"},
			useAdd:         true,
			expectedStatus: 200,
		},
		{
			name:           "Support for deflate and gzip via separate headers",
			encodings:      []string{"deflate", "gzip"},
			useAdd:         true,
			expectedStatus: 200,
		},
		{
			name:           "Support for comma-separated gzip, deflate",
			encodings:      []string{"gzip", "deflate"},
			joinComma:      true,
			expectedStatus: 200,
		},
		{
			name:           "Support for comma-separated deflate, gzip",
			encodings:      []string{"deflate", "gzip"},
			joinComma:      true,
			expectedStatus: 200,
		},
		{
			name:           "Comma-separated with spaces",
			encodings:      []string{"gzip", "deflate"},
			joinComma:      true,
			expectedStatus: 200,
		},
		{
			name:           "No support for deflate and br via separate headers",
			encodings:      []string{"deflate", "br"},
			useAdd:         true,
			expectedStatus: 415,
		},
		{
			name:           "No support for comma-separated deflate, br",
			encodings:      []string{"deflate", "br"},
			joinComma:      true,
			expectedStatus: 415,
		},
		{
			name:           "Case insensitive encoding names",
			encodings:      []string{"GZip", "DEFLATE"},
			joinComma:      true,
			expectedStatus: 200,
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			body := []byte("This is my content. There are many like this but this one is mine")
			r := httptest.NewRequest("POST", "/", bytes.NewReader(body))
			switch {
			case tt.joinComma && len(tt.encodings) > 0:
				r.Header.Set("Content-Encoding", joinWithCommaSpace(tt.encodings))
			case tt.useAdd:
				for _, encoding := range tt.encodings {
					r.Header.Add("Content-Encoding", encoding)
				}
			default:
				for _, encoding := range tt.encodings {
					r.Header.Set("Content-Encoding", encoding)
				}
			}

			w := httptest.NewRecorder()
			router := chi.NewRouter()
			router.Use(middleware)
			router.Post("/", func(w http.ResponseWriter, r *http.Request) {})

			router.ServeHTTP(w, r)
			res := w.Result()
			if res.StatusCode != tt.expectedStatus {
				t.Errorf("response is incorrect, got %d, want %d", w.Code, tt.expectedStatus)
			}
		})
	}
}

func joinWithCommaSpace(parts []string) string {
	out := parts[0]
	for i := 1; i < len(parts); i++ {
		out += ", " + parts[i]
	}
	return out
}
