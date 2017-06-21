package middleware

import (
	"github.com/pressly/chi"

	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHeartBeat(t *testing.T) {
	heartbeat := "/heartbeat"
	req, _ := http.NewRequest("GET", heartbeat, nil)
	w := httptest.NewRecorder()
	r := chi.NewRouter()
	r.Use(Heartbeat(heartbeat))

	r.Get("/", func(w http.ResponseWriter, r *http.Request) {})

	r.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatal("Response Code should be 200")
	}

	if w.Result().Header.Get("Content-Type") != "text/plain" {
		t.Fatal("Content-Type should be text/plain")
	}

	if w.Body.String() != "." {
		t.Fatal("Response body should be . ")
	}
}
