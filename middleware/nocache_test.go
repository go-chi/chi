package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/pressly/chi"
)

func TestNoCache(t *testing.T) {
	req, _ := http.NewRequest("GET", "/", nil)

	for _, v := range etagHeaders {
		req.Header.Add(v, "1234abcd")
	}

	w := httptest.NewRecorder()
	r := chi.NewRouter()
	r.Use(NoCache)

	var reqHeader http.Header
	var resHeader http.Header
	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		reqHeader = r.Header
		resHeader = w.Header()
		w.Write([]byte("Hello World"))
	})
	r.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Fatal("Response Code should be 200")
	}

	for _, v := range etagHeaders {
		if reqHeader.Get(v) != "" {
			t.Fatal("etagHeaders should be empty.")
		}
	}

	for k, v := range noCacheHeaders {
		if resHeader.Get(k) != v {
			t.Fatal("Response NoCacheHeader error.")
		}
	}
}
