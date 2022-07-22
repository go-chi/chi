package middleware

import (
	"bytes"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/FallenTaters/chio"
)

func panicingHandler(http.ResponseWriter, *http.Request) { panic("foo") }

func TestRecoverer(t *testing.T) {
	r := chio.NewRouter()

	buf := new(bytes.Buffer)

	r.Use(Recover(DefaultPanicLogger(buf)))
	r.Get("/", panicingHandler)

	ts := httptest.NewServer(r)
	defer ts.Close()

	res, _ := testRequest(t, ts, "GET", "/", nil)
	assertEqual(t, res.StatusCode, http.StatusInternalServerError)

	lines := strings.Split(buf.String(), "\n")
	assertEqual(t, lines[0], `GET "/" - panic: foo`)
	assertEqual(t, lines[1], "\tgithub.com/FallenTaters/chio/middleware.panicingHandler")
	assertTrue(t, strings.HasPrefix(lines[2], "\t\t"), lines[2])
	assertTrue(t, strings.HasSuffix(lines[2], "chio/middleware/recover_test.go:13"), lines[2])
}

func TestRecovererAbortHandler(t *testing.T) {
	defer func() {
		rcv := recover()
		if err, _ := rcv.(error); errors.Is(err, http.ErrAbortHandler) {
			t.Fatalf("http.ErrAbortHandler should not be recovered")
		}
	}()

	w := httptest.NewRecorder()

	r := chio.NewRouter()
	r.Use(Recover(nil))

	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		panic(http.ErrAbortHandler)
	})

	req, err := http.NewRequest("GET", "/", nil)
	if err != nil {
		t.Fatal(err)
	}

	r.ServeHTTP(w, req)
}
