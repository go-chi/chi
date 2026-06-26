package middleware

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

func panickingHandler(http.ResponseWriter, *http.Request) { panic("foo") }

func TestRecoverer(t *testing.T) {
	r := chi.NewRouter()

	oldRecovererErrorWriter := recovererErrorWriter
	defer func() { recovererErrorWriter = oldRecovererErrorWriter }()
	buf := &bytes.Buffer{}
	recovererErrorWriter = buf

	r.Use(Recoverer)
	r.Get("/", panickingHandler)

	ts := httptest.NewServer(r)
	defer ts.Close()

	res, _ := testRequest(t, ts, "GET", "/", nil)
	assertEqual(t, res.StatusCode, http.StatusInternalServerError)

	lines := strings.Split(buf.String(), "\n")
	for _, line := range lines {
		if strings.HasPrefix(strings.TrimSpace(line), "->") {
			if !strings.Contains(line, "panickingHandler") {
				t.Fatalf("First func call line should refer to panickingHandler, but actual line:\n%v\n", line)
			}
			return
		}
	}
	t.Fatal("First func call line should start with ->.")
}

func TestRecovererAbortHandler(t *testing.T) {
	defer func() {
		rcv := recover()
		if rcv != http.ErrAbortHandler {
			t.Fatalf("http.ErrAbortHandler should not be recovered")
		}
	}()

	w := httptest.NewRecorder()

	r := chi.NewRouter()
	r.Use(Recoverer)

	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		panic(http.ErrAbortHandler)
	})

	req, err := http.NewRequest("GET", "/", nil)
	if err != nil {
		t.Fatal(err)
	}

	r.ServeHTTP(w, req)
}

// Regression for #1042. When the logger has NoColor=true, the pretty
// stack output from a panic should also be uncolored. Previously
// defaultLogEntry.Panic forwarded to PrintPrettyStack which hard-coded
// useColor=true, so panic traces always came out with ANSI sequences
// when the surrounding terminal was a TTY, even if the request logs
// above them honored NoColor.
func TestRequestLoggerPanicRespectsNoColor(t *testing.T) {
	// cW gates color emission on the package-level IsTTY flag, which is
	// false in CI. Flip it on for this test so the buggy path actually
	// produces ANSI sequences for the regression to catch.
	oldIsTTY := IsTTY
	IsTTY = true
	defer func() { IsTTY = oldIsTTY }()

	oldWriter := recovererErrorWriter
	defer func() { recovererErrorWriter = oldWriter }()
	buf := &bytes.Buffer{}
	recovererErrorWriter = buf

	r := chi.NewRouter()
	r.Use(RequestLogger(&DefaultLogFormatter{Logger: nopLogger{}, NoColor: true}))
	r.Use(Recoverer)
	r.Get("/", panickingHandler)

	ts := httptest.NewServer(r)
	defer ts.Close()

	res, _ := testRequest(t, ts, "GET", "/", nil)
	assertEqual(t, res.StatusCode, http.StatusInternalServerError)

	if strings.Contains(buf.String(), "\x1b[") {
		t.Fatalf("panic output should be uncolored when NoColor=true, got:\n%s", buf.String())
	}
}

type nopLogger struct{}

func (nopLogger) Print(...interface{}) {}
