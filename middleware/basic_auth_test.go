package middleware

import (
	"mime"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

var testAuthCreds = map[string]string{
	"testUser": "testPassword",
}

func TestBasicAuthRealm(t *testing.T) {
	for _, realm := range []string{"localhost", "", `private "area"`, `team\\shared`, `team\"shared"`} {
		t.Run(realm, func(t *testing.T) {
			handler := BasicAuth(realm, testAuthCreds)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				t.Error("unauthenticated request reached the handler")
			}))
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/secure", nil))
			if response.Code != http.StatusUnauthorized {
				t.Fatalf("status code = %d, want %d", response.Code, http.StatusUnauthorized)
			}
			challenge := response.Header().Get("WWW-Authenticate")
			if !strings.HasPrefix(challenge, "Basic ") {
				t.Fatalf("invalid challenge scheme: %q", challenge)
			}
			_, params, err := mime.ParseMediaType("Basic; " + strings.TrimPrefix(challenge, "Basic "))
			if err != nil {
				t.Fatalf("invalid challenge %q: %v", challenge, err)
			}
			if got := params["realm"]; got != realm {
				t.Errorf("realm = %q, want %q", got, realm)
			}
		})
	}
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
