package middleware

import (
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
)

func testRequest(t *testing.T, ts *httptest.Server, method, path string, body io.Reader) (*http.Response, string) {
	req, err := http.NewRequest(method, ts.URL+path, body)
	if err != nil {
		t.Fatal(err)
		return nil, ""
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
		return nil, ""
	}

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
		return nil, ""
	}
	defer resp.Body.Close()

	return resp, string(respBody)
}

func assertEqual[T any](t *testing.T, a, b T) {
	t.Helper()
	if !reflect.DeepEqual(a, b) {
		t.Errorf("expecting values to be equal but got: '%v' and '%v'", a, b)
	}
}

func assertTrue(t *testing.T, v bool, msg any) {
	t.Helper()
	if !v {
		t.Error("expected to be true: ", msg)
	}
}
