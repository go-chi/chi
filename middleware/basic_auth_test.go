package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	chi "github.com/go-chi/chi/v5"
)

var testAuthCreds = map[string]string{
	"testUser": "testPassword",
}

func TestBasicAuth(t *testing.T) {
	r := chi.NewRouter()
	r.Use(BasicAuth("localhost", testAuthCreds))
	r.Get("/secure", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("authentication accepted"))
	}))

	cases := []struct {
		name         string
		digest       string
		expected     int
		errorMessage string
		wantErr      bool
	}{
		{
			name:         "No auth header provided",
			expected:     http.StatusUnauthorized,
			errorMessage: "basic auth: accepted request without a valid header",
			wantErr:      true,
		},
		{
			name:         "Invalid auth header provided",
			digest:       "Basic dGVzdFVzZXI6d3JvbmdwYXNzd29yZA==",
			expected:     http.StatusUnauthorized,
			errorMessage: "basic auth: accepted invalid bearer token",
			wantErr:      true,
		},
		{
			name:         "Valid auth header provided",
			digest:       "Basic dGVzdFVzZXI6dGVzdFBhc3N3b3Jk",
			expected:     http.StatusOK,
			errorMessage: "basic auth: did not accept a valid bearer token",
			wantErr:      false,
		},
	}

	for _, c := range cases {
		// Record response
		w := httptest.NewRecorder()
		req, err := http.NewRequest("GET", "/secure", nil)
		if err != nil {
			t.Fatalf("basic auth: failed to create test request")
		}

		if c.digest != "" {
			req.Header.Set("Authorization", c.digest)
		}

		// Serve request
		r.ServeHTTP(w, req)

		// Test response code
		if w.Result().StatusCode != c.expected {
			t.Errorf(c.errorMessage)
		}
	}
}
