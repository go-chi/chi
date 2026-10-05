package middleware

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestThrottleRetryAfterDuration(t *testing.T) {
	for _, tc := range []struct {
		name  string
		delay time.Duration
		want  string
	}{
		{"negative", -time.Second, "0"},
		{"minimum", time.Duration(-1 << 63), "0"},
		{"zero", 0, "0"},
		{"nanosecond", time.Nanosecond, "1"},
		{"subsecond", 500 * time.Millisecond, "1"},
		{"second", time.Second, "1"},
		{"fractional", 1500 * time.Millisecond, "2"},
		{"just over second", time.Second + time.Nanosecond, "2"},
		{"hour", time.Hour, "3600"},
		{"maximum", time.Duration(1<<63 - 1), "9223372037"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			entered, release := make(chan struct{}), make(chan struct{})
			calls := make(chan bool, 1)
			h := ThrottleWithOpts(ThrottleOpts{
				Limit: 1,
				RetryAfterFn: func(ctxDone bool) time.Duration {
					calls <- ctxDone
					return tc.delay
				},
			})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				close(entered)
				<-release
				io.WriteString(w, "accepted")
			}))
			ts := httptest.NewServer(h)
			defer ts.Close()
			released := false
			defer func() {
				if !released {
					close(release)
				}
			}()
			client := ts.Client()
			client.Timeout = 5 * time.Second
			accepted := make(chan error, 1)
			go func() {
				resp, err := client.Get(ts.URL)
				if err == nil {
					body, readErr := io.ReadAll(resp.Body)
					resp.Body.Close()
					if readErr != nil {
						err = readErr
					} else if resp.StatusCode != http.StatusOK || string(body) != "accepted" || resp.Header.Get("Retry-After") != "" {
						err = fmt.Errorf("accepted request: status=%d body=%q Retry-After=%q", resp.StatusCode, body, resp.Header.Get("Retry-After"))
					}
				}
				accepted <- err
			}()
			select {
			case <-entered:
			case <-time.After(5 * time.Second):
				t.Fatal("first request did not enter handler")
			}
			resp, err := client.Get(ts.URL)
			if err != nil {
				t.Fatal(err)
			}
			defer resp.Body.Close()
			body, err := io.ReadAll(resp.Body)
			if err != nil {
				t.Fatal(err)
			}
			if resp.StatusCode != http.StatusTooManyRequests || string(body) != errCapacityExceeded+"\n" {
				t.Fatalf("got %d %q", resp.StatusCode, body)
			}
			if got := resp.Header.Get("Retry-After"); got != tc.want {
				t.Errorf("Retry-After = %q, want %q", got, tc.want)
			}
			if ctxDone := <-calls; ctxDone {
				t.Error("capacity rejection passed ctxDone=true")
			}
			defer func() {
				close(release)
				released = true
				if err := <-accepted; err != nil {
					t.Error(err)
				}
			}()
		})
	}
}

func TestThrottleRetryAfterCancelledDuration(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	entered, release, finished := make(chan struct{}), make(chan struct{}), make(chan struct{})
	var calls int
	h := ThrottleWithOpts(ThrottleOpts{
		Limit: 1,
		RetryAfterFn: func(ctxDone bool) time.Duration {
			calls++
			if !ctxDone {
				t.Error("cancel rejection passed ctxDone=false")
			}
			return 1500 * time.Millisecond
		},
	})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(entered)
		<-release
	}))
	go func() {
		h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))
		close(finished)
	}()
	defer func() { close(release); <-finished }()
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("first request did not enter handler")
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil).WithContext(ctx))
	if calls != 1 || rec.Code != http.StatusTooManyRequests || rec.Header().Get("Retry-After") != "2" {
		t.Fatalf("calls=%d status=%d Retry-After=%q", calls, rec.Code, rec.Header().Get("Retry-After"))
	}
}
