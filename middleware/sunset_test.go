package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
)

func TestSunset(t *testing.T) {

	t.Run("Sunset without link", func(t *testing.T) {
		req, _ := http.NewRequest("GET", "/", nil)
		w := httptest.NewRecorder()

		r := chi.NewRouter()

		sunsetAt := time.Date(2025, 12, 24, 10, 20, 0, 0, time.UTC)
		r.Use(Sunset(sunsetAt))

		var sunset, deprecation string
		r.Get("/", func(w http.ResponseWriter, r *http.Request) {
			clonedHeader := w.Header().Clone()
			sunset = clonedHeader.Get("Sunset")
			deprecation = clonedHeader.Get("Deprecation")
			w.Write([]byte("I'll be unavailable soon"))
		})
		r.ServeHTTP(w, req)

		if w.Code != 200 {
			t.Fatal("Response Code should be 200")
		}

		if sunset != "Wed, 24 Dec 2025 10:20:00 GMT" {
			t.Fatal("Test get sunset error.", sunset)
		}

		if deprecation != "" {
			t.Fatal("Sunset should not set Deprecation.", deprecation)
		}
	})

	t.Run("Sunset with link", func(t *testing.T) {
		req, _ := http.NewRequest("GET", "/", nil)
		w := httptest.NewRecorder()

		r := chi.NewRouter()

		sunsetAt := time.Date(2025, 12, 24, 10, 20, 0, 0, time.UTC)
		sunsetLink := `<https://example.com/v1/sunset-details>; rel="sunset"`
		r.Use(Sunset(sunsetAt, sunsetLink))

		var sunset, deprecation, link string
		r.Get("/", func(w http.ResponseWriter, r *http.Request) {
			clonedHeader := w.Header().Clone()
			sunset = clonedHeader.Get("Sunset")
			deprecation = clonedHeader.Get("Deprecation")
			link = clonedHeader.Get("Link")

			w.Write([]byte("I'll be unavailable soon"))
		})

		r.ServeHTTP(w, req)

		if w.Code != 200 {
			t.Fatal("Response Code should be 200")
		}

		if sunset != "Wed, 24 Dec 2025 10:20:00 GMT" {
			t.Fatal("Test get sunset error.", sunset)
		}

		if deprecation != "" {
			t.Fatal("Sunset should not set Deprecation.", deprecation)
		}

		if link != sunsetLink {
			t.Fatal("Test get sunset link error.")
		}
	})

	t.Run("Zero time panics", func(t *testing.T) {
		defer func() {
			if recover() == nil {
				t.Fatal("Sunset should panic for zero time.")
			}
		}()
		Sunset(time.Time{})
	})
}

/**
EXAMPLE USAGES
func main() {
	r := chi.NewRouter()

	sunsetAt := time.Date(2025, 12, 24, 10, 20, 0, 0, time.UTC)
	r.Use(middleware.Sunset(sunsetAt))

	// can provide a Link header value (RFC 8288) pointing at more details
	// r.Use(middleware.Sunset(sunsetAt, `<https://example.com/v1/sunset-details>; rel="sunset"`))

	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("This endpoint will be removed soon"))
	})

	log.Println("Listening on port: 3000")
	http.ListenAndServe(":3000", r)
}
**/
