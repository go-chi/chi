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

// TestRecovererUpgradeConnectionDetection verifies that the Recoverer does not
// write a 500 status code when the Connection header indicates an upgrade.
// HTTP headers are case-insensitive (RFC 7230 §3.2) and the Connection header
// can contain multiple comma-separated tokens (e.g. "keep-alive, Upgrade").
// The current implementation only matches the exact string "Upgrade".
func TestRecovererUpgradeConnectionDetection(t *testing.T) {
	tests := []struct {
		name       string
		connHeader string
		expect500  bool
	}{
		{
			name:       "exact Upgrade is not 500",
			connHeader: "Upgrade",
			expect500:  false,
		},
		{
			name:       "lowercase upgrade is not 500",
			connHeader: "upgrade",
			expect500:  false,
		},
		{
			name:       "Upgrade in token list is not 500",
			connHeader: "keep-alive, Upgrade",
			expect500:  false,
		},
		{
			name:       "no Connection header is 500",
			connHeader: "",
			expect500:  true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			oldRecovererErrorWriter := recovererErrorWriter
			defer func() { recovererErrorWriter = oldRecovererErrorWriter }()
			recovererErrorWriter = &bytes.Buffer{}

			r := chi.NewRouter()
			r.Use(Recoverer)
			r.Get("/", panickingHandler)

			w := httptest.NewRecorder()
			req, err := http.NewRequest("GET", "/", nil)
			if err != nil {
				t.Fatal(err)
			}
			if tc.connHeader != "" {
				req.Header.Set("Connection", tc.connHeader)
			}

			r.ServeHTTP(w, req)

			got500 := w.Code == http.StatusInternalServerError
			if got500 != tc.expect500 {
				t.Errorf("Connection: %q — got status %d, expected 500=%v",
					tc.connHeader, w.Code, tc.expect500)
			}
		})
	}
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
