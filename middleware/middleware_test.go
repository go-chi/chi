package middleware

import (
	"io"
	"io/ioutil"
	"net/http"
	"net/http/httptest"
	"testing"
)

func testRequest(t *testing.T, ts *httptest.Server, method, path string, body io.Reader) (int, string) {
	req, err := http.NewRequest(method, ts.URL+path, body)
	if err != nil {
		t.Fatal(err)
		return 0, ""
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
		return resp.StatusCode, ""
	}

	respBody, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
		return resp.StatusCode, ""
	}
	defer resp.Body.Close()

	return resp.StatusCode, string(respBody)
}

type responseWriter struct{}

func (m *responseWriter) Header() http.Header {
	return http.Header{}
}

func (m *responseWriter) Write(p []byte) (int, error) {
	return len(p), nil
}

func (m *responseWriter) WriteString(s string) (int, error) {
	return len(s), nil
}

func (m *responseWriter) WriteHeader(int) {}
