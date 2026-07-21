package chi

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// Regression for #1035: a static path that exists for some methods must not
// fall through to a sibling param route when the request method is unsupported.
func TestStaticRouteMethodNotAllowedOverParam(t *testing.T) {
	r := NewRouter()
	r.StrictRouting(true)
	r.Get("/users", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("list"))
	})
	r.Get("/users/me", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("me"))
	})
	r.Get("/users/{id}", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("id=" + URLParam(r, "id")))
	})
	r.Put("/users/{id}", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("put=" + URLParam(r, "id")))
	})

	ts := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/users/me", nil)
	r.ServeHTTP(ts, req)
	if ts.Code != 200 || ts.Body.String() != "me" {
		t.Fatalf("GET /users/me: got %d %q", ts.Code, ts.Body.String())
	}

	// PUT /users/me must be 405, not PUT /users/{id} with id=me
	ts = httptest.NewRecorder()
	req = httptest.NewRequest("PUT", "/users/me", nil)
	r.ServeHTTP(ts, req)
	if ts.Code != 405 {
		t.Fatalf("PUT /users/me: want 405, got %d body=%q", ts.Code, ts.Body.String())
	}
	if ts.Body.String() != "" && ts.Body.String() == "put=me" {
		t.Fatalf("PUT /users/me fell through to param route: body=%q", ts.Body.String())
	}

	// PUT /users/123 still hits param route
	ts = httptest.NewRecorder()
	req = httptest.NewRequest("PUT", "/users/123", nil)
	r.ServeHTTP(ts, req)
	if ts.Code != 200 || ts.Body.String() != "put=123" {
		t.Fatalf("PUT /users/123: got %d %q", ts.Code, ts.Body.String())
	}
}
