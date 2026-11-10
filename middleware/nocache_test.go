package middleware

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
)

func TestNoCachePreservesRequestPreconditionHeaders(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("If-Match", `"current"`)
	req.Header.Set("If-None-Match", `"stale"`)
	req.Header.Set("If-Unmodified-Since", "Wed, 21 Oct 2015 07:28:00 GMT")

	handler := NoCache(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("If-Match"); got != `"current"` {
			t.Fatalf("If-Match header = %q, want %q", got, `"current"`)
		}
		if got := r.Header.Get("If-None-Match"); got != `"stale"` {
			t.Fatalf("If-None-Match header = %q, want %q", got, `"stale"`)
		}
		if got := r.Header.Get("If-Unmodified-Since"); got != "Wed, 21 Oct 2015 07:28:00 GMT" {
			t.Fatalf("If-Unmodified-Since header = %q", got)
		}
		w.WriteHeader(http.StatusNoContent)
	}))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if got := rec.Header().Get("Cache-Control"); got == "" {
		t.Fatal("Cache-Control header was not set")
	}
	if got := rec.Code; got != http.StatusNoContent {
		t.Fatalf("status code = %d, want %d", got, http.StatusNoContent)
	}
}

func TestNoCacheConditionalRequests(t *testing.T) {
	modified := time.Date(2026, time.January, 2, 3, 4, 5, 0, time.UTC)
	router := chi.NewRouter()
	router.Use(NoCache)
	router.Get("/document", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("ETag", `"current"`)
		http.ServeContent(w, r, "document.txt", modified, strings.NewReader("document"))
	})
	server := httptest.NewServer(router)
	defer server.Close()

	tests := []struct {
		name    string
		headers map[string]string
		status  int
		body    string
	}{
		{"unconditional", nil, http.StatusOK, "document"},
		{"stale etag", map[string]string{"If-Match": `"stale"`}, http.StatusPreconditionFailed, ""},
		{"current etag", map[string]string{"If-Match": `"current"`}, http.StatusOK, "document"},
		{"cached etag", map[string]string{"If-None-Match": `"current"`}, http.StatusNotModified, ""},
		{"modified since", map[string]string{"If-Modified-Since": modified.Format(http.TimeFormat)}, http.StatusNotModified, ""},
		{"unmodified since", map[string]string{"If-Unmodified-Since": modified.Add(-time.Hour).Format(http.TimeFormat)}, http.StatusPreconditionFailed, ""},
		{"current range", map[string]string{"Range": "bytes=0-2", "If-Range": `"current"`}, http.StatusPartialContent, "doc"},
		{"stale range", map[string]string{"Range": "bytes=0-2", "If-Range": `"stale"`}, http.StatusOK, "document"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			req, err := http.NewRequest(http.MethodGet, server.URL+"/document", nil)
			if err != nil {
				t.Fatal(err)
			}
			for name, value := range test.headers {
				req.Header.Set(name, value)
			}
			res, err := server.Client().Do(req)
			if err != nil {
				t.Fatal(err)
			}
			defer res.Body.Close()
			body, err := io.ReadAll(res.Body)
			if err != nil {
				t.Fatal(err)
			}
			if res.StatusCode != test.status || string(body) != test.body {
				t.Errorf("response = %d %q, want %d %q", res.StatusCode, body, test.status, test.body)
			}
			for name, value := range map[string]string{
				"Expires":         "Thu, 01 Jan 1970 00:00:00 GMT",
				"Cache-Control":   "no-cache, no-store, no-transform, must-revalidate, private, max-age=0",
				"Pragma":          "no-cache",
				"X-Accel-Expires": "0",
			} {
				if got := res.Header.Get(name); got != value {
					t.Errorf("%s = %q, want %q", name, got, value)
				}
			}
		})
	}
}

func TestNoCacheConditionalUpdates(t *testing.T) {
	var mu sync.Mutex
	value := "original"
	router := chi.NewRouter()
	router.Use(NoCache)
	router.Put("/document", func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		if match := r.Header.Get("If-Match"); match != "" && match != `"current"` {
			w.WriteHeader(http.StatusPreconditionFailed)
			return
		}
		if r.Header.Get("If-None-Match") == "*" {
			w.WriteHeader(http.StatusPreconditionFailed)
			return
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		value = string(body)
		w.WriteHeader(http.StatusNoContent)
	})
	server := httptest.NewServer(router)
	defer server.Close()

	for _, test := range []struct {
		name   string
		header string
		match  string
		status int
		value  string
	}{
		{"stale update", "If-Match", `"stale"`, http.StatusPreconditionFailed, "original"},
		{"create existing resource", "If-None-Match", "*", http.StatusPreconditionFailed, "original"},
		{"current update", "If-Match", `"current"`, http.StatusNoContent, "updated"},
	} {
		t.Run(test.name, func(t *testing.T) {
			mu.Lock()
			value = "original"
			mu.Unlock()
			req, err := http.NewRequest(http.MethodPut, server.URL+"/document", strings.NewReader("updated"))
			if err != nil {
				t.Fatal(err)
			}
			req.Header.Set(test.header, test.match)
			res, err := server.Client().Do(req)
			if err != nil {
				t.Fatal(err)
			}
			res.Body.Close()
			if res.StatusCode != test.status {
				t.Errorf("status = %d, want %d", res.StatusCode, test.status)
			}
			mu.Lock()
			defer mu.Unlock()
			if value != test.value {
				t.Errorf("stored value = %q, want %q", value, test.value)
			}
		})
	}
}
