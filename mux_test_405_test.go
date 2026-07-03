package chi

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMethodNotAllowedDeduplication(t *testing.T) {
	r := NewRouter()
	r.Post("/article/1-2-3", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	r.Post("/article/{a}", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	r.Post("/article/{b}-{c}", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	r.Post("/article/{b}-{c}-{d}", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	ts := httptest.NewServer(r)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/article/1-2-3")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 405 {
		t.Errorf("expected 405, got %d", resp.StatusCode)
	}

	allow := resp.Header["Allow"]
	// Count POST occurrences
	count := 0
	for _, v := range allow {
		if v == "POST" {
			count++
		}
	}
	if count > 1 {
		t.Errorf("Allow header has duplicate POST: %v (count=%d)", allow, count)
	}
}
