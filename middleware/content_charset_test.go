package middleware

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

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
