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
	endpoint := "/secure"
	r := chi.NewRouter()
	r.Use(BasicAuth("localhost", testAuthCreds))
	r.Get(endpoint, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("authentication accepted"))
	}))

	cases := []struct {
		name     string
		digest   string
		expected int
	}{
		{
			name:     "no authorization header",
			expected: http.StatusUnauthorized,
		},
		{
			name:     "invalid basic auth credentials",
			digest:   "Basic dGVzdFVzZXI6d3JvbmdwYXNzd29yZA==",
			expected: http.StatusUnauthorized,
		},
		{
			name:     "valid basic auth credentials",
			digest:   "Basic dGVzdFVzZXI6dGVzdFBhc3N3b3Jk",
			expected: http.StatusOK,
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, endpoint, http.NoBody)
			if c.digest != "" {
				req.Header.Set("Authorization", c.digest)
			}

			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if got := w.Code; got != c.expected {
				t.Errorf("status code = %d, expected %d", got, c.expected)
			}
		})
	}
}
