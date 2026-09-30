package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
)

func TestDeprecation(t *testing.T) {
	deprecatedAt := time.Date(2025, 12, 24, 10, 20, 0, 0, time.UTC)

	serve := func(mw func(http.Handler) http.Handler) http.Header {
		r := chi.NewRouter()
		r.Use(mw)
		r.Get("/", func(w http.ResponseWriter, r *http.Request) {
			w.Write([]byte("ok"))
		})
		w := httptest.NewRecorder()
		req, _ := http.NewRequest("GET", "/", nil)
		r.ServeHTTP(w, req)
		if w.Code != 200 {
			t.Fatal("Response Code should be 200")
		}
		return w.Header()
	}

	t.Run("Deprecation without link", func(t *testing.T) {
		h := serve(Deprecation(deprecatedAt))

		if got, want := h.Get("Deprecation"), "@1766571600"; got != want {
			t.Fatalf("Deprecation = %q, want %q", got, want)
		}
		if h.Get("Sunset") != "" {
			t.Fatal("Deprecation should not set Sunset.")
		}
		if h.Get("Link") != "" {
			t.Fatal("Link should be empty.")
		}
	})

	t.Run("Deprecation with link", func(t *testing.T) {
		link := `<https://example.com/v1/deprecation-details>; rel="deprecation"`
		h := serve(Deprecation(deprecatedAt, link))

		if got, want := h.Get("Deprecation"), "@1766571600"; got != want {
			t.Fatalf("Deprecation = %q, want %q", got, want)
		}
		if got := h.Get("Link"); got != link {
			t.Fatalf("Link = %q, want %q", got, link)
		}
	})

	t.Run("Zero time panics", func(t *testing.T) {
		defer func() {
			if recover() == nil {
				t.Fatal("Deprecation should panic for zero time.")
			}
		}()
		Deprecation(time.Time{})
	})

	t.Run("Combined with Sunset", func(t *testing.T) {
		sunsetAt := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
		h := serve(func(next http.Handler) http.Handler {
			return Deprecation(deprecatedAt)(Sunset(sunsetAt)(next))
		})

		if h.Get("Deprecation") != "@1766571600" {
			t.Fatal("Deprecation header missing.")
		}
		if got, want := h.Get("Sunset"), "Mon, 01 Jun 2026 00:00:00 GMT"; got != want {
			t.Fatalf("Sunset = %q, want %q", got, want)
		}
	})
}
