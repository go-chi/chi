package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestThrottleRetryAfterBacklogDuration(t *testing.T) {
	entered, release, finished := make(chan struct{}), make(chan struct{}), make(chan struct{})
	var calls int
	h := ThrottleWithOpts(ThrottleOpts{
		Limit: 1, BacklogLimit: 1, BacklogTimeout: time.Millisecond,
		RetryAfterFn: func(ctxDone bool) time.Duration {
			calls++
			if ctxDone {
				t.Error("backlog timeout passed ctxDone=true")
			}
			return 500 * time.Millisecond
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
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if calls != 1 || rec.Code != http.StatusTooManyRequests || rec.Body.String() != errTimedOut+"\n" || rec.Header().Get("Retry-After") != "1" {
		t.Fatalf("calls=%d status=%d body=%q Retry-After=%q", calls, rec.Code, rec.Body.String(), rec.Header().Get("Retry-After"))
	}
}

func TestThrottleNoRetryAfterCallback(t *testing.T) {
	entered, release, finished := make(chan struct{}), make(chan struct{}), make(chan struct{})
	h := Throttle(1)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Code != http.StatusTooManyRequests || rec.Header().Get("Retry-After") != "" {
		t.Fatalf("status=%d Retry-After=%q", rec.Code, rec.Header().Get("Retry-After"))
	}
}
