package middleware

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

// setupRouter returns a chi router with a GET and HEAD handler for /hi.
// It is just a small helper to avoid code duplication in the tests.
func setupRouter(withAllowHeader bool) *chi.Mux {
	r := chi.NewRouter()
	if withAllowHeader {
		r.Use(SetAllowHeader)
	}
	r.Get("/hi", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("hi, get"))
	})

	r.Head("/hi", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("hi, head"))
	})

	return r
}

func TestSetAllowHeader(t *testing.T) {
	r := setupRouter(true)

	ts := httptest.NewServer(r)
	defer ts.Close()

	t.Run("Registered Method", func(t *testing.T) {
		res, err := http.Get(ts.URL + "/hi")
		if err != nil {
			t.Fatal(err)
		}
		if res.StatusCode != 200 {
			t.Fatal(res.Status)
		}
		if res.Header.Values("Allow") != nil {
			t.Fatal("allow:", res.Header.Values("Allow"))
		}
	})

	t.Run("Unregistered Method", func(t *testing.T) {
		res, err := http.Post(ts.URL+"/hi", "text/plain", nil)
		if err != nil {
			t.Fatal(err)
		}
		if res.StatusCode != 405 {
			t.Fatal(res.Status)
		}
		if res.Header.Values("Allow")[0] != "GET" || res.Header.Values("Allow")[1] != "HEAD" {
			t.Fatal(res.Header.Get("Allow"))
		}
	})
}

func ExampleSetAllowHeader() {
	r := chi.NewRouter()
	r.Use(SetAllowHeader)
	r.Get("/hi", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("hi, get"))
	})
	r.Head("/hi", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("hi, head"))
	})

	ts := httptest.NewServer(r)
	defer ts.Close()

	res, _ := http.Post(ts.URL+"/hi", "text/plain", nil)
	fmt.Println(res.Status)
	fmt.Println(res.Header.Values("Allow"))

	// Output:
	// 405 Method Not Allowed
	// [GET HEAD]
}

func BenchmarkSetAllowHeaderWhen405(b *testing.B) {
	r := setupRouter(true)

	req, err := http.NewRequest("POST", "/hi", nil)
	if err != nil {
		b.Fatal(err)
	}

	w := httptest.NewRecorder()

	for i := 0; i < b.N; i++ {
		r.ServeHTTP(w, req)
		res := w.Result()
		if res.StatusCode != 405 {
			b.Fatal(res.Status)
		}
		if res.Header.Values("Allow")[0] != "GET" || res.Header.Values("Allow")[1] != "HEAD" {
			b.Fatal(res.Header.Get("Allow"))
		}
	}
}

func BenchmarkSetAllowHeaderWhen200(b *testing.B) {
	r := setupRouter(true)

	req, err := http.NewRequest("GET", "/hi", nil)
	if err != nil {
		b.Fatal(err)
	}

	w := httptest.NewRecorder()

	for i := 0; i < b.N; i++ {
		r.ServeHTTP(w, req)
		res := w.Result()
		if res.StatusCode != 200 {
			b.Fatal(res.Status)
		}
		if res.Header.Values("Allow") != nil {
			b.Fatal(res.Header.Get("Allow"))
		}
	}
}

func BenchmarkWithoutSetAllowHeader(b *testing.B) {
	r := setupRouter(false)

	req, err := http.NewRequest("GET", "/hi", nil)
	if err != nil {
		b.Fatal(err)
	}

	w := httptest.NewRecorder()

	for i := 0; i < b.N; i++ {
		r.ServeHTTP(w, req)
		res := w.Result()
		if res.StatusCode != 200 {
			b.Fatal(res.Status)
		}
		if res.Header.Values("Allow") != nil {
			b.Fatal(res.Header.Get("Allow"))
		}
	}
}
