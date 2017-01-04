package middleware

import (
	"io"
	"io/ioutil"
	"net/http"
	"net/http/httptest"
	"path"
	"reflect"
	"runtime"
	"testing"
)

// NOTE: we must import `golang.org/x/net/http2` in order to explicitly enable
// http2 transports for certain tests. The runtime pkg does not have this dependency
// though as the transport configuration happens under the hood on go 1.7+.

var testdataDir string

func init() {
	_, filename, _, _ := runtime.Caller(0)
	testdataDir = path.Join(path.Dir(filename), "/../testdata")
}

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

func assertNoError(t *testing.T, err error) {
	if err != nil {
		t.Fatalf("expecting no error")
	}
}

func assertError(t *testing.T, err error) {
	if err == nil {
		t.Fatalf("expecting error")
	}
}

func assertEqual(t *testing.T, a, b interface{}) {
	if !reflect.DeepEqual(a, b) {
		t.Fatalf("expecting values to be equal but got: '%v' and '%v'", a, b)
	}
}
