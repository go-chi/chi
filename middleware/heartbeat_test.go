package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestHeartbeat(t *testing.T) {
	endpoint := "/ping"

	r := chi.NewRouter()
	r.Use(Heartbeat(endpoint))
	r.Handle(endpoint, http.NotFoundHandler())

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, endpoint, http.NoBody)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("heartbeat: unexpected response code: %v", w.Code)
	}
	if w.Body.String() != "." {
		t.Errorf("heartbeat: unexpected response body: %q", w.Body.String())
	}
	if got := w.Header().Get("Content-Type"); got != "text/plain" {
		t.Errorf("heartbeat: unexpected Content-Type: %q", got)
	}

	// Heartbeat also works as a plain net/http middleware, where the
	// request has no chi RouteContext.
	h := Heartbeat(endpoint)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTeapot)
	}))
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, endpoint, http.NoBody))
	if w.Code != http.StatusOK {
		t.Errorf("heartbeat: unexpected response code without router: %v", w.Code)
	}
}

// TestHeartbeatMounted ensures the heartbeat endpoint is served from mounted
// subrouters too, where the routing path is relative to the mount point (#821).
func TestHeartbeatMounted(t *testing.T) {
	endpoint := "/ping"

	sub := chi.NewRouter()
	sub.Use(Heartbeat(endpoint))
	sub.Get("/", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("sub index"))
	})

	r := chi.NewRouter()
	r.Use(Heartbeat(endpoint))
	r.Mount("/connectivity", sub)

	tests := []struct {
		method   string
		path     string
		wantCode int
		wantBody string
	}{
		{http.MethodGet, "/connectivity" + endpoint, http.StatusOK, "."},
		{http.MethodPost, "/connectivity" + endpoint, http.StatusNotFound, "404 page not found\n"},
		{http.MethodGet, "/connectivity/", http.StatusOK, "sub index"},
	}

	for _, tc := range tests {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			w := httptest.NewRecorder()
			r.ServeHTTP(w, httptest.NewRequest(tc.method, tc.path, http.NoBody))

			if w.Code != tc.wantCode {
				t.Errorf("unexpected response code: got %v, want %v", w.Code, tc.wantCode)
			}
			if w.Body.String() != tc.wantBody {
				t.Errorf("unexpected response body: got %q, want %q", w.Body.String(), tc.wantBody)
			}
		})
	}
}
