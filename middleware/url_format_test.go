package middleware

import (
	"io/ioutil"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi"
)

func setupSimpleURLFormatTestServer() *httptest.Server {
	r := chi.NewRouter()
	r.Use(URLFormat)
	r.Get("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("root"))
	}))
	r.Get("/foo", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ext, ok := r.Context().Value(URLFormatCtxKey).(string)
		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(http.StatusOK)
		if ok {
			w.Write([]byte("/foo." + ext))
		} else {
			w.Write([]byte("/foo"))
		}
	}))
	r.Get("/bar/baz", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ext, ok := r.Context().Value(URLFormatCtxKey).(string)
		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(http.StatusOK)
		if ok {
			w.Write([]byte("/bar/baz." + ext))
		} else {
			w.Write([]byte("/bar/baz"))
		}
	}))
	return httptest.NewServer(r)
}

func setupNestedURLFormatTestServer() *httptest.Server {
	r := chi.NewRouter()
	r.Get("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("root"))
	}))
	r.Route("/bar", func(r chi.Router) {
		r.Use(URLFormat)
		r.Get("/baz", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ext, ok := r.Context().Value(URLFormatCtxKey).(string)
			w.Header().Set("Content-Type", "text/plain")
			w.WriteHeader(http.StatusOK)
			if ok {
				w.Write([]byte("/bar/baz." + ext))
			} else {
				w.Write([]byte("/bar/baz"))
			}
		}))
	})
	return httptest.NewServer(r)
}

func TestURLFormat(t *testing.T) {
	t.Run("Simple", func(t *testing.T) {
		ts := setupSimpleURLFormatTestServer()
		defer ts.Close()
		testShouldBeOK(t, ts.URL+"/", "root")
		testShouldBeOK(t, ts.URL+"/foo", "/foo")
		testShouldBeOK(t, ts.URL+"/foo.txt", "/foo.txt")
		testShouldBeOK(t, ts.URL+"/foo.tar.gz", "/foo.tar.gz")
		testShouldBeNotFound(t, ts.URL+"/bar")
		testShouldBeNotFound(t, ts.URL+"/bar.txt")
		testShouldBeNotFound(t, ts.URL+"/bar.txt/")
		testShouldBeNotFound(t, ts.URL+"/bar.txt/baz")
		testShouldBeNotFound(t, ts.URL+"/bar.txt/baz.txt")
		testShouldBeOK(t, ts.URL+"/bar/baz", "/bar/baz")
		testShouldBeOK(t, ts.URL+"/bar/baz.txt", "/bar/baz.txt")
		testShouldBeOK(t, ts.URL+"/bar/baz.tar.gz", "/bar/baz.tar.gz")
	})

	t.Run("Nested", func(t *testing.T) {
		ts := setupNestedURLFormatTestServer()
		defer ts.Close()
		testShouldBeOK(t, ts.URL+"/", "root")
		testShouldBeNotFound(t, ts.URL+"/bar")
		testShouldBeNotFound(t, ts.URL+"/bar.txt")
		testShouldBeNotFound(t, ts.URL+"/bar.txt/")
		testShouldBeNotFound(t, ts.URL+"/bar.txt/baz")
		testShouldBeNotFound(t, ts.URL+"/bar.txt/baz.txt")
		testShouldBeOK(t, ts.URL+"/bar/baz", "/bar/baz")
		testShouldBeOK(t, ts.URL+"/bar/baz.txt", "/bar/baz.txt")
		testShouldBeOK(t, ts.URL+"/bar/baz.tar.gz", "/bar/baz.tar.gz")
	})
}

func testShouldBeOK(t *testing.T, url, expected string) {
	res, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}

	defer res.Body.Close()
	b, err := ioutil.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}

	if res.StatusCode != http.StatusOK {
		t.Errorf("StatusCode should be %d, but got %d", http.StatusOK, res.StatusCode)
	}
	if body := string(b); body != expected {
		t.Errorf("Body should be %#v, but got %#v", expected, body)
	}
}

func testShouldBeNotFound(t *testing.T, url string) {
	res, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}

	if res.StatusCode != http.StatusNotFound {
		t.Errorf("StatusCode should be %d, but got %d", http.StatusNotFound, res.StatusCode)
	}
}
