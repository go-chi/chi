package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNoCachePreservesRequestPreconditionHeaders(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("If-Match", `"current"`)
	req.Header.Set("If-None-Match", `"stale"`)
	req.Header.Set("If-Unmodified-Since", "Wed, 21 Oct 2015 07:28:00 GMT")

	handler := NoCache(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("If-Match"); got != `"current"` {
			t.Fatalf("If-Match header = %q, want %q", got, `"current"`)
		}
		if got := r.Header.Get("If-None-Match"); got != `"stale"` {
			t.Fatalf("If-None-Match header = %q, want %q", got, `"stale"`)
		}
		if got := r.Header.Get("If-Unmodified-Since"); got != "Wed, 21 Oct 2015 07:28:00 GMT" {
			t.Fatalf("If-Unmodified-Since header = %q", got)
		}
		w.WriteHeader(http.StatusNoContent)
	}))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if got := rec.Header().Get("Cache-Control"); got == "" {
		t.Fatal("Cache-Control header was not set")
	}
	if got := rec.Code; got != http.StatusNoContent {
		t.Fatalf("status code = %d, want %d", got, http.StatusNoContent)
	}
}
