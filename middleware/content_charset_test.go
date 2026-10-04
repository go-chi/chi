package middleware

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
)

func TestContentCharset(t *testing.T) {
	t.Parallel()

	var tests = []struct {
		name                string
		inputValue          string
		inputContentCharset []string
		body                string
		want                int
	}{
		{
			"should accept requests with a matching charset",
			"application/json; charset=UTF-8",
			[]string{"UTF-8"},
			"foobar",
			http.StatusOK,
		},
		{
			"should be case-insensitive",
			"application/json; charset=utf-8",
			[]string{"UTF-8"},
			"foobar",
			http.StatusOK,
		},
		{
			"should accept requests with a matching charset with extra values",
			"application/json; foo=bar; charset=UTF-8; spam=eggs",
			[]string{"UTF-8"},
			"foobar",
			http.StatusOK,
		},
		{
			"should accept requests with a matching charset when multiple charsets are supported",
			"text/xml; charset=UTF-8",
			[]string{"UTF-8", "Latin-1"},
			"foobar",
			http.StatusOK,
		},
		{
			"should accept requests with no charset if empty charset headers are allowed",
			"text/xml",
			[]string{"UTF-8", ""},
			"foobar",
			http.StatusOK,
		},
		{
			"should not accept requests with no charset if empty charset headers are not allowed",
			"text/xml",
			[]string{"UTF-8"},
			"foobar",
			http.StatusUnsupportedMediaType,
		},
		{
			"should not accept requests with a mismatching charset",
			"text/plain; charset=Latin-1",
			[]string{"UTF-8"},
			"foobar",
			http.StatusUnsupportedMediaType,
		},
		{
			"should not accept requests with a mismatching charset even if empty charsets are allowed",
			"text/plain; charset=Latin-1",
			[]string{"UTF-8", ""},
			"foobar",
			http.StatusUnsupportedMediaType,
		},
		{
			"should skip validation for requests without a body",
			"text/plain; charset=Latin-1",
			[]string{"UTF-8"},
			"",
			http.StatusOK,
		},
		{
			"should skip validation for requests without a body and no Content-Type header",
			"",
			[]string{"UTF-8"},
			"",
			http.StatusOK,
		},
	}

	for _, tt := range tests {
		var tt = tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			var recorder = httptest.NewRecorder()

			var r = chi.NewRouter()
			r.Use(ContentCharset(tt.inputContentCharset...))
			r.Post("/", func(w http.ResponseWriter, r *http.Request) {})

			var body io.Reader
			if tt.body != "" {
				body = strings.NewReader(tt.body)
			}

			var req, _ = http.NewRequest("POST", "/", body)
			if tt.inputValue != "" {
				req.Header.Set("Content-Type", tt.inputValue)
			}

			r.ServeHTTP(recorder, req)
			var res = recorder.Result()

			if res.StatusCode != tt.want {
				t.Errorf("response is incorrect, got %d, want %d", recorder.Code, tt.want)
			}
		})
	}
}

func TestSplit(t *testing.T) {
	t.Parallel()

	var s1, s2 = split("  type1;type2  ", ";")

	if s1 != "type1" || s2 != "type2" {
		t.Errorf("Want type1, type2 got %s, %s", s1, s2)
	}

	s1, s2 = split("type1  ", ";")

	if s1 != "type1" {
		t.Errorf("Want \"type1\" got \"%s\"", s1)
	}
	if s2 != "" {
		t.Errorf("Want empty string got \"%s\"", s2)
	}
}

func TestContentEncoding(t *testing.T) {
	t.Parallel()

	if !contentEncoding("application/json; foo=bar; charset=utf-8; spam=eggs", []string{"utf-8"}...) {
		t.Error("Want true, got false")
	}

	if contentEncoding("text/plain; charset=latin-1", []string{"utf-8"}...) {
		t.Error("Want false, got true")
	}

	if !contentEncoding("text/xml; charset=UTF-8", []string{"latin-1", "utf-8"}...) {
		t.Error("Want true, got false")
	}
}

func TestContentCharsetMediaParameters(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		header  string
		allowed []string
		want    int
	}{
		{"quoted", `text/plain; charset="UTF-8"`, []string{"UTF-8"}, http.StatusAccepted},
		{"quoted mixed case", `Text/Plain; Charset="uTf-8"`, []string{"UTF-8"}, http.StatusAccepted},
		{"quoted pair", `text/plain; charset="UTF\-8"`, []string{"UTF-8"}, http.StatusAccepted},
		{"escaped quote in preceding parameter", `text/plain; note="say \"charset=latin-1\""; charset=utf-8`, []string{"UTF-8"}, http.StatusAccepted},
		{"literal backslash is not a quoted pair", `text/plain; charset="UTF\\-8"`, []string{"UTF-8", ""}, http.StatusUnsupportedMediaType},
		{"preceding quoted parameter", `text/plain; note="charset=latin-1"; charset=utf-8`, []string{"UTF-8"}, http.StatusAccepted},
		{"quoted semicolon", `text/plain; note="first; charset=latin-1"; charset="utf-8"`, []string{"UTF-8"}, http.StatusAccepted},
		{"following parameter", `text/plain; charset="utf-8"; note="first; second"`, []string{"UTF-8"}, http.StatusAccepted},
		{"missing charset in quoted parameter", `text/plain; note="charset=utf-8"`, []string{"UTF-8", ""}, http.StatusAccepted},
		{"missing charset disallowed", `text/plain; note="charset=utf-8"`, []string{"UTF-8"}, http.StatusUnsupportedMediaType},
		{"unsupported quoted charset", `text/plain; charset="latin-1"`, []string{"UTF-8", ""}, http.StatusUnsupportedMediaType},
		{"unquoted control", `text/plain; charset=UTF-8`, []string{"UTF-8"}, http.StatusAccepted},
		{"missing header control", "", []string{"UTF-8", ""}, http.StatusAccepted},
		{"no allowed charset", `text/plain; charset="utf-8"`, nil, http.StatusUnsupportedMediaType},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			const body = "charset request body"
			called := false
			router := chi.NewRouter()
			router.Use(ContentCharset(tc.allowed...))
			router.Post("/", func(w http.ResponseWriter, r *http.Request) {
				called = true
				data, err := io.ReadAll(r.Body)
				if err != nil {
					t.Errorf("read body: %v", err)
				}
				if string(data) != body {
					t.Errorf("body = %q, want %q", data, body)
				}
				if got := r.Header.Get("Content-Type"); got != tc.header {
					t.Errorf("Content-Type changed to %q, want %q", got, tc.header)
				}
				w.WriteHeader(http.StatusAccepted)
			})
			req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
			req.Header.Set("Content-Type", tc.header)
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, req)
			if recorder.Code != tc.want {
				t.Errorf("status = %d, want %d", recorder.Code, tc.want)
			}
			if want := tc.want == http.StatusAccepted; called != want {
				t.Errorf("handler called = %t, want %t", called, want)
			}
		})
	}
}

func TestContentCharsetMediaParametersOverHTTP(t *testing.T) {
	router := chi.NewRouter()
	router.Use(ContentCharset("UTF-8", ""))
	router.Post("/", func(w http.ResponseWriter, r *http.Request) {
		defer r.Body.Close()
		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if r.ContentLength == -1 {
			if len(r.TransferEncoding) != 1 || r.TransferEncoding[0] != "chunked" {
				http.Error(w, "missing chunked framing", http.StatusInternalServerError)
				return
			}
			w.Header().Set("X-Body-Framing", "chunked")
		} else {
			w.Header().Set("X-Body-Framing", "known")
		}
		w.Header().Set("X-Request-Content-Type", r.Header.Get("Content-Type"))
		w.WriteHeader(http.StatusAccepted)
		if _, err := w.Write(body); err != nil {
			t.Errorf("write response: %v", err)
		}
	})
	server := httptest.NewServer(router)
	defer server.Close()
	client := server.Client()
	client.Timeout = 5 * time.Second
	defer client.CloseIdleConnections()
	tests := []struct {
		name   string
		header string
		want   int
	}{
		{"quoted charset", `text/plain; charset="UTF-8"`, http.StatusAccepted},
		{"preceding quoted parameter", `text/plain; note="first; charset=latin-1"; charset=utf-8`, http.StatusAccepted},
		{"missing charset", `text/plain; note="charset=utf-8"`, http.StatusAccepted},
		{"unsupported charset", `text/plain; charset="latin-1"`, http.StatusUnsupportedMediaType},
	}
	for _, tc := range tests {
		for _, framing := range []string{"known", "chunked"} {
			t.Run(tc.name+"/"+framing, func(t *testing.T) {
				const body = "body survives charset parsing"
				var input io.Reader = strings.NewReader(body)
				if framing == "chunked" {
					input = struct{ io.Reader }{input}
				}
				req, err := http.NewRequest(http.MethodPost, server.URL, input)
				if err != nil {
					t.Fatal(err)
				}
				req.Header.Set("Content-Type", tc.header)
				res, err := client.Do(req)
				if err != nil {
					t.Fatal(err)
				}
				data, readErr := io.ReadAll(res.Body)
				closeErr := res.Body.Close()
				if readErr != nil || closeErr != nil {
					t.Fatalf("response body: read %v, close %v", readErr, closeErr)
				}
				if res.StatusCode != tc.want {
					t.Errorf("status = %d, want %d", res.StatusCode, tc.want)
				}
				if tc.want == http.StatusAccepted {
					if string(data) != body {
						t.Errorf("response = %q, want %q", data, body)
					}
					if got := res.Header.Get("X-Body-Framing"); got != framing {
						t.Errorf("framing = %q, want %q", got, framing)
					}
					if got := res.Header.Get("X-Request-Content-Type"); got != tc.header {
						t.Errorf("Content-Type = %q, want %q", got, tc.header)
					}
				} else if res.Header.Get("X-Body-Framing") != "" {
					t.Error("unsupported charset reached the handler")
				}
			})
		}
	}
}
