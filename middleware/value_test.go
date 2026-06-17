package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	chi "github.com/go-chi/chi/v5"
)

func TestWithValue(t *testing.T) {
	ctxKey := "customKey"
	ctxValue := "customValue"
	request := func() *http.Request {
		req, _ := http.NewRequest("GET", "/", nil)
		return req
	}
	testHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		val := r.Context().Value(ctxKey).(string)
		w.Write([]byte(val))
	})

	w := httptest.NewRecorder()
	r := chi.NewRouter()
	r.Use(WithValue(ctxKey, ctxValue))
	r.Get("/", testHandler)

	r.ServeHTTP(w, request())

	if w.Body.String() != ctxValue {
		t.Errorf("value: context did not contain expected value")
	}
}
