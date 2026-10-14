package middleware

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestSupressNotFoundMount(t *testing.T) {
	r := chi.NewRouter()
	r.Use(SupressNotFound(r))
	r.Route("/{tenant}", func(r chi.Router) {
		r.Use(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("X-Auth") != "ok" {
					http.Error(w, "unauthorized", http.StatusUnauthorized)
					return
				}
				next.ServeHTTP(w, r)
			})
		})
		r.Get("/data/{id}", func(w http.ResponseWriter, r *http.Request) {
			w.Write([]byte("mounted tenant=" + chi.URLParam(r, "tenant")))
		})
		r.Get("/settings", func(w http.ResponseWriter, r *http.Request) {
			w.Write([]byte("settings tenant=" + chi.URLParam(r, "tenant")))
		})
	})
	r.Get("/data/{id}", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("root tenant=" + chi.URLParam(r, "tenant")))
	})

	ts := httptest.NewServer(r)
	defer ts.Close()

	tests := []struct {
		name     string
		path     string
		auth     bool
		wantCode int
		wantBody string
	}{
		{"mounted without auth", "/acme/data/42", false, http.StatusUnauthorized, ""},
		{"mounted with auth", "/acme/data/42", true, http.StatusOK, "mounted tenant=acme"},
		{"mounted only route with auth", "/acme/settings", true, http.StatusOK, "settings tenant=acme"},
		{"root route", "/data/42", false, http.StatusOK, "root tenant="},
		{"no route", "/nope", true, http.StatusNotFound, "404 page not found\n"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req, err := http.NewRequest("GET", ts.URL+tt.path, nil)
			if err != nil {
				t.Fatal(err)
			}
			if tt.auth {
				req.Header.Set("X-Auth", "ok")
			}
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			defer resp.Body.Close()
			b, err := io.ReadAll(resp.Body)
			if err != nil {
				t.Fatal(err)
			}
			body := string(b)

			if resp.StatusCode != tt.wantCode {
				t.Fatalf("status: want %d, got %d (body %q)", tt.wantCode, resp.StatusCode, body)
			}
			if tt.wantBody != "" && body != tt.wantBody {
				t.Fatalf("body: want %q, got %q", tt.wantBody, body)
			}
		})
	}
}

func TestSupressNotFoundRoutePattern(t *testing.T) {
	r := chi.NewRouter()
	r.Use(SupressNotFound(r))
	var got string
	r.Get("/users/{id}", func(w http.ResponseWriter, r *http.Request) {
		got = chi.RouteContext(r.Context()).RoutePattern()
	})
	ts := httptest.NewServer(r)
	defer ts.Close()
	testRequest(t, ts, "GET", "/users/42", nil)
	if got != "/users/{id}" {
		t.Fatalf("RoutePattern: got %q, want %q", got, "/users/{id}")
	}
}
