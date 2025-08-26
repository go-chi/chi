//go:build go1.23
// +build go1.23

package chi

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPattern(t *testing.T) {
	testCases := []struct {
		name        string
		pattern     string
		method      string
		requestPath string
	}{
		{
			name:        "Basic path value",
			pattern:     "/hubs/{hubID}",
			method:      "GET",
			requestPath: "/hubs/392",
		},
		{
			name:        "Two path values",
			pattern:     "/users/{userID}/conversations/{conversationID}",
			method:      "POST",
			requestPath: "/users/Gojo/conversations/2948",
		},
		{
			name:        "Wildcard path",
			pattern:     "/users/{userID}/friends/*",
			method:      "POST",
			requestPath: "/users/Gojo/friends/all-of-them/and/more",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			r := NewRouter()

			r.Handle(tc.method+" "+tc.pattern, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Write([]byte(r.Pattern))
			}))

			ts := httptest.NewServer(r)
			defer ts.Close()

			_, body := testRequest(t, ts, tc.method, tc.requestPath, nil)
			if body != tc.pattern {
				t.Fatalf("expecting %q, got %q", tc.pattern, body)
			}
		})
	}
}
