package middleware

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
)

var testContent = []byte("Hello world!")

func waitN(t *testing.T, ch <-chan struct{}, n int) {
	t.Helper()
	deadline := time.After(2 * time.Second)
	for i := 0; i < n; i++ {
		select {
		case <-ch:
		case <-deadline:
			t.Fatalf("timed out waiting for %d events, got %d", n, i)
		}
	}
}

func serveThrottle(h http.Handler, req *http.Request) *httptest.ResponseRecorder {
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	return rr
}

func TestThrottleBacklog(t *testing.T) {
	started := make(chan struct{}, 2)
	release := make(chan struct{})

	h := ThrottleBacklog(2, 2, time.Second)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started <- struct{}{}
		<-release
		w.WriteHeader(http.StatusOK)
		w.Write(testContent)
	}))

	results := make(chan *httptest.ResponseRecorder, 4)
	for range 4 {
		go func() {
			results <- serveThrottle(h, httptest.NewRequest(http.MethodGet, "/", nil))
		}()
	}

	waitN(t, started, 2)
	close(release)

	for range 4 {
		select {
		case rr := <-results:
			assertEqual(t, http.StatusOK, rr.Code)
			assertEqual(t, testContent, rr.Body.Bytes())
		case <-time.After(2 * time.Second):
			t.Fatal("timed out waiting for throttled request to complete")
		}
	}
}

func TestThrottleContextCanceled(t *testing.T) {
	started := make(chan struct{}, 1)
	release := make(chan struct{})
	defer close(release)

	h := ThrottleBacklog(1, 1, time.Second)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started <- struct{}{}
		<-release
		w.WriteHeader(http.StatusOK)
		w.Write(testContent)
	}))

	go serveThrottle(h, httptest.NewRequest(http.MethodGet, "/", nil))
	waitN(t, started, 1)

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		req := httptest.NewRequest(http.MethodGet, "/", nil).WithContext(ctx)
		done <- serveThrottle(h, req)
	}()
	cancel()

	select {
	case rr := <-done:
		assertEqual(t, http.StatusTooManyRequests, rr.Code)
		assertEqual(t, errContextCanceled, strings.TrimSpace(rr.Body.String()))
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for canceled request")
	}
}

func TestThrottleTriggerGatewayTimeout(t *testing.T) {
	started := make(chan struct{}, 1)
	release := make(chan struct{})
	defer close(release)

	h := ThrottleBacklog(1, 1, 50*time.Millisecond)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started <- struct{}{}
		<-release
		w.WriteHeader(http.StatusOK)
		w.Write(testContent)
	}))

	go serveThrottle(h, httptest.NewRequest(http.MethodGet, "/", nil))
	waitN(t, started, 1)

	rr := serveThrottle(h, httptest.NewRequest(http.MethodGet, "/", nil))
	assertEqual(t, http.StatusTooManyRequests, rr.Code)
	assertEqual(t, errTimedOut, strings.TrimSpace(rr.Body.String()))
}

func TestThrottleMaximum(t *testing.T) {
	started := make(chan struct{}, 1)
	release := make(chan struct{})

	h := ThrottleBacklog(1, 0, time.Second)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started <- struct{}{}
		<-release
		w.WriteHeader(http.StatusOK)
		w.Write(testContent)
	}))

	occupying := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		occupying <- serveThrottle(h, httptest.NewRequest(http.MethodGet, "/", nil))
	}()
	waitN(t, started, 1)

	rr := serveThrottle(h, httptest.NewRequest(http.MethodGet, "/", nil))
	assertEqual(t, http.StatusTooManyRequests, rr.Code)
	assertEqual(t, errCapacityExceeded, strings.TrimSpace(rr.Body.String()))

	close(release)
	select {
	case got := <-occupying:
		assertEqual(t, http.StatusOK, got.Code)
		assertEqual(t, testContent, got.Body.Bytes())
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for occupying request to complete")
	}
}

func TestThrottleRetryAfter(t *testing.T) {
	retryAfterFn := func(ctxDone bool) time.Duration { return time.Hour }
	started := make(chan struct{}, 5)
	release := make(chan struct{})

	h := ThrottleWithOpts(ThrottleOpts{
		Limit:        5,
		BacklogLimit: 0,
		RetryAfterFn: retryAfterFn,
	})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started <- struct{}{}
		<-release
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	}))

	type result struct {
		status int
		header http.Header
	}
	results := make(chan result, 10)

	for range 5 {
		go func() {
			rr := serveThrottle(h, httptest.NewRequest(http.MethodGet, "/", nil))
			results <- result{status: rr.Code, header: rr.Header().Clone()}
		}()
	}
	waitN(t, started, 5)

	for range 5 {
		go func() {
			rr := serveThrottle(h, httptest.NewRequest(http.MethodGet, "/", nil))
			results <- result{status: rr.Code, header: rr.Header().Clone()}
		}()
	}

	count429 := 0
	for range 5 {
		select {
		case res := <-results:
			assertEqual(t, http.StatusTooManyRequests, res.status)
			assertEqual(t, "3600", res.header.Get("Retry-After"))
			count429++
		case <-time.After(2 * time.Second):
			t.Fatal("timed out waiting for Retry-After rejection")
		}
	}

	close(release)

	count200 := 0
	for range 5 {
		select {
		case res := <-results:
			assertEqual(t, http.StatusOK, res.status)
			count200++
		case <-time.After(2 * time.Second):
			t.Fatal("timed out waiting for successful throttled request")
		}
	}

	assertEqual(t, 5, count200)
	assertEqual(t, 5, count429)
}

func TestThrottleCustomStatusCode(t *testing.T) {
	const timeout = time.Second * 3

	wait := make(chan struct{})

	r := chi.NewRouter()
	r.Use(ThrottleWithOpts(ThrottleOpts{Limit: 1, StatusCode: http.StatusServiceUnavailable}))
	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-wait:
		case <-time.After(timeout):
		}
		w.WriteHeader(http.StatusOK)
	})
	server := httptest.NewServer(r)
	defer server.Close()

	const totalRequestCount = 5

	codes := make(chan int, totalRequestCount)
	errs := make(chan error, totalRequestCount)
	client := &http.Client{Timeout: timeout}
	for range totalRequestCount {
		go func() {
			resp, err := client.Get(server.URL)
			if err != nil {
				errs <- err
				return
			}
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
			codes <- resp.StatusCode
		}()
	}

	waitResponse := func(wantCode int) {
		select {
		case err := <-errs:
			t.Fatal(err)
		case code := <-codes:
			assertEqual(t, wantCode, code)
		case <-time.After(timeout):
			t.Fatalf("waiting %d code, timeout exceeded", wantCode)
		}
	}

	for range totalRequestCount - 1 {
		waitResponse(http.StatusServiceUnavailable)
	}
	close(wait) // Allow the last request to proceed.
	waitResponse(http.StatusOK)
}

func BenchmarkThrottle(b *testing.B) {
	throttleMiddleware := ThrottleBacklog(1000, 50, time.Second)

	handler := throttleMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/", nil)

	b.ReportAllocs()
	for b.Loop() {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
	}
}
