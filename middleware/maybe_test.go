package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMaybeBuildsMiddlewareOnce(t *testing.T) {
	var builds, calls int
	mw := func(next http.Handler) http.Handler {
		builds++
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			calls++
			next.ServeHTTP(w, r)
		})
	}

	handler := Maybe(mw, func(*http.Request) bool { return true })(
		http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}),
	)
	for range 2 {
		handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))
	}

	if builds != 1 {
		t.Fatalf("middleware was built %d times, want 1", builds)
	}
	if calls != 2 {
		t.Fatalf("middleware handled %d requests, want 2", calls)
	}
}
