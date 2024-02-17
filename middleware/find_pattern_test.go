package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestFindPattern(t *testing.T) {
	t.Parallel()

	var tests = []struct {
		pattern string
		path    string
	}{
		{
			"/",
			"/",
		},
		{
			"/hi",
			"/hi",
		},
		{
			"/{id}",
			"/123",
		},
		{
			"/{id}/hello",
			"/123/hello",
		},
		{
			"/users/*",
			"/users/123",
		},
		{
			"/users/*",
			"/users/123/hello",
		},
	}

	for _, tt := range tests {
		var tt = tt
		t.Run(tt.pattern, func(t *testing.T) {
			t.Parallel()

			recorder := httptest.NewRecorder()

			r := chi.NewRouter()
			r.Use(FindPattern(r, func(pattern string) {
				if pattern != tt.pattern {
					t.Errorf("actual pattern \"%s\" does not equal expected pattern \"%s\"", pattern, tt.pattern)
				}
			}))

			r.Get(tt.pattern, func(w http.ResponseWriter, r *http.Request) {
				w.Write([]byte(""))
			})

			req := httptest.NewRequest("GET", tt.path, nil)
			r.ServeHTTP(recorder, req)
			recorder.Result()
		})
	}
}
