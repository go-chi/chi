package middleware

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi"
)

func TestBasicAuth(t *testing.T) {
	realm := "myRealm"

	acceptedCreds := map[string]string{
		"gooduser": "goodpassword",
	}

	r := chi.NewRouter()
	r.Use(BasicAuth(realm, acceptedCreds))
	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("Hello World"))
	})

	testAuth(t, r, "gooduser", "goodpassword", 200, nil)
	testAuth(t, r, "gooduser", "badpassword", 401, &realm)
	testAuth(t, r, "baduser", "goodpassword", 401, &realm)
	testAuth(t, r, "baduser", "badpassword", 401, &realm)
}

func testAuth(t *testing.T, r *chi.Mux, user string, password string, expectedCode int, realm *string) {
	req, _ := http.NewRequest("GET", "/", nil)
	req.SetBasicAuth(user, password)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != expectedCode {
		t.Fatalf("With %s:%s expected status code to be %d but got %d", user, password,
			expectedCode, w.Code)
	}

	if realm != nil {
		expected := fmt.Sprintf("Basic realm=\"%s\"", *realm)
		got := w.Header().Get("WWW-Authenticate")
		if !strings.HasPrefix(got, expected) {
			t.Fatalf("Expected WWW-Authenticate with realm '%s' but got '%s'", *realm, got)
		}
	}
}
