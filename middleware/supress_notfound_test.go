package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestSupressNotFound(t *testing.T) {
	mr := chi.NewRouter()

	outsideBody := "Outside"
	helloWorldBody := "Hello World"
	insideBody := "Inside"
	insideArgBodyPrefix := "Inside: "
	notFoundBody := "404 page not found\n"

	mr.Get("/outside", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(outsideBody))
	})

	type testContextKey struct{}

	type testCase struct {
		t     *testing.T
		valid bool
	}

	mr.Route("/first", func(r chi.Router) {
		r.Use(SupressNotFound(mr))
		r.Use(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				tc := r.Context().Value(testContextKey{}).(testCase)
				if !tc.valid {
					t.Fatal("Next middleware in chain should not be called for invalid paths")
				}
				next.ServeHTTP(w, r)
			})
		})

		r.Get("/hello-world", func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(helloWorldBody))
		})

		r.Route("/sub", func(r chi.Router) {
			r.Get("/inside", func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusOK)
				w.Write([]byte(insideBody))
			})
		})

		r.Route("/sub-arg/{id}", func(r chi.Router) {
			r.Get("/inside", func(w http.ResponseWriter, r *http.Request) {
				id := chi.URLParam(r, "id")

				w.WriteHeader(http.StatusOK)
				w.Write([]byte(insideArgBodyPrefix + id))
			})
		})
	})

	t.Run("Valid root path", func(t *testing.T) {
		ctx := context.WithValue(context.Background(), testContextKey{}, testCase{
			t:     t,
			valid: true,
		})
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, "/outside", nil)
		w := httptest.NewRecorder()

		mr.ServeHTTP(w, req)

		if w.Code != 200 {
			t.Fatal("Response Code should be 200")
		}

		respBody := w.Body.String()
		if respBody != outsideBody {
			t.Fatalf("Response body should be \"%s\" (got: \"%s\")", outsideBody, respBody)
		}
	})

	t.Run("Valid first sub router path", func(t *testing.T) {
		ctx := context.WithValue(context.Background(), testContextKey{}, testCase{
			t:     t,
			valid: true,
		})
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, "/first/hello-world", nil)
		w := httptest.NewRecorder()

		mr.ServeHTTP(w, req)

		if w.Code != 200 {
			t.Fatal("Response Code should be 200")
		}

		respBody := w.Body.String()
		if respBody != helloWorldBody {
			t.Fatalf("Response body should be \"%s\" (got: \"%s\")", helloWorldBody, respBody)
		}
	})

	t.Run("Valid second sub router path", func(t *testing.T) {
		ctx := context.WithValue(context.Background(), testContextKey{}, testCase{
			t:     t,
			valid: true,
		})
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, "/first/sub/inside", nil)
		w := httptest.NewRecorder()

		mr.ServeHTTP(w, req)

		if w.Code != 200 {
			t.Fatal("Response Code should be 200")
		}

		respBody := w.Body.String()
		if respBody != insideBody {
			t.Fatalf("Response body should be \"%s\" (got: \"%s\")", insideBody, respBody)
		}
	})

	t.Run("Valid third sub router path with URL argument", func(t *testing.T) {
		ctx := context.WithValue(context.Background(), testContextKey{}, testCase{
			t:     t,
			valid: true,
		})
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, "/first/sub-arg/123/inside", nil)
		w := httptest.NewRecorder()

		mr.ServeHTTP(w, req)

		if w.Code != 200 {
			t.Fatal("Response Code should be 200")
		}

		insideArgBody := insideArgBodyPrefix + "123"

		respBody := w.Body.String()
		if respBody != insideArgBody {
			t.Fatalf("Response body should be \"%s\" (got: \"%s\")", insideArgBody, respBody)
		}
	})

	t.Run("Invalid path", func(t *testing.T) {
		ctx := context.WithValue(context.Background(), testContextKey{}, testCase{
			t:     t,
			valid: false,
		})
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, "/invalid-path", nil)
		w := httptest.NewRecorder()

		mr.ServeHTTP(w, req)

		if w.Code != 404 {
			t.Fatal("Response Code should be 404")
		}

		respBody := w.Body.String()
		if respBody != notFoundBody {
			t.Fatalf("Response body should be \"%s\" (got: \"%s\")", notFoundBody, respBody)
		}
	})

	t.Run("Invalid first sub router path", func(t *testing.T) {
		ctx := context.WithValue(context.Background(), testContextKey{}, testCase{
			t:     t,
			valid: false,
		})
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, "/first/invalid-path", nil)
		w := httptest.NewRecorder()

		mr.ServeHTTP(w, req)

		if w.Code != 404 {
			t.Fatal("Response Code should be 404")
		}

		respBody := w.Body.String()
		if respBody != notFoundBody {
			t.Fatalf("Response body should be \"%s\" (got: \"%s\")", notFoundBody, respBody)
		}
	})

	t.Run("Valid first sub router path but invalid method", func(t *testing.T) {
		ctx := context.WithValue(context.Background(), testContextKey{}, testCase{
			t:     t,
			valid: false,
		})
		req, _ := http.NewRequestWithContext(ctx, http.MethodPost, "/first/hello-world", nil)
		w := httptest.NewRecorder()

		mr.ServeHTTP(w, req)

		if w.Code != 404 { // Should be 405 if there is a proper implementation.
			t.Fatal("Response Code should be 404")
		}

		respBody := w.Body.String()
		if respBody != notFoundBody {
			t.Fatalf("Response body should be \"%s\" (got: \"%s\")", notFoundBody, respBody)
		}
	})

	t.Run("Invalid second sub router path", func(t *testing.T) {
		ctx := context.WithValue(context.Background(), testContextKey{}, testCase{
			t:     t,
			valid: false,
		})
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, "/first/sub/invalid-path", nil)
		w := httptest.NewRecorder()

		mr.ServeHTTP(w, req)

		if w.Code != 404 {
			t.Fatal("Response Code should be 404")
		}

		respBody := w.Body.String()
		if respBody != notFoundBody {
			t.Fatalf("Response body should be \"%s\" (got: \"%s\")", notFoundBody, respBody)
		}
	})
}
