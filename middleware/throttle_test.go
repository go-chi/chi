package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

var testContent = []byte("Hello world!")

const throttleTestTimeout = 30 * time.Second

// ThrottleWithOpts calls Done a second time only after taking a backlog token
// and finding no processing token. Keep this handshake in step with its selects.
type secondDoneContext struct {
	context.Context
	calls      atomic.Int32
	secondDone chan struct{}
}

func (c *secondDoneContext) Done() <-chan struct{} {
	if c.calls.Add(1) == 2 {
		close(c.secondDone)
	}
	return c.Context.Done()
}

func waitN(t *testing.T, ch <-chan struct{}, n int) {
	t.Helper()
	timer := time.NewTimer(throttleTestTimeout)
	defer timer.Stop()
	for i := 0; i < n; i++ {
		select {
		case <-ch:
		case <-timer.C:
			t.Fatalf("timed out waiting for %d events, got %d", n, i)
		}
	}
}

func serveThrottle(h http.Handler, req *http.Request) <-chan *httptest.ResponseRecorder {
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		done <- rr
	}()
	return done
}

func waitThrottle(t *testing.T, done <-chan *httptest.ResponseRecorder) *httptest.ResponseRecorder {
	t.Helper()
	timer := time.NewTimer(throttleTestTimeout)
	defer timer.Stop()
	select {
	case rr := <-done:
		return rr
	case <-timer.C:
		t.Fatal("timed out waiting for throttled request to complete")
		return nil
	}
}

func TestThrottleBacklog(t *testing.T) {
	started := make(chan struct{}, 2)
	release := make(chan struct{})
	unblock := sync.OnceFunc(func() { close(release) })
	t.Cleanup(unblock)

	h := ThrottleBacklog(2, 2, time.Minute)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started <- struct{}{}
		<-release
		w.WriteHeader(http.StatusOK)
		w.Write(testContent)
	}))

	var results []<-chan *httptest.ResponseRecorder
	for range 2 {
		results = append(results, serveThrottle(h, httptest.NewRequest(http.MethodGet, "/", nil)))
	}
	waitN(t, started, 2)

	for range 2 {
		ctx := &secondDoneContext{Context: context.Background(), secondDone: make(chan struct{})}
		results = append(results, serveThrottle(h, httptest.NewRequest(http.MethodGet, "/", nil).WithContext(ctx)))
		waitN(t, ctx.secondDone, 1)
	}
	unblock()

	for _, done := range results {
		rr := waitThrottle(t, done)
		assertEqual(t, http.StatusOK, rr.Code)
		assertEqual(t, testContent, rr.Body.Bytes())
	}
}

func TestThrottleContextCanceled(t *testing.T) {
	started := make(chan struct{}, 1)
	release := make(chan struct{})
	unblock := sync.OnceFunc(func() { close(release) })
	t.Cleanup(unblock)

	h := ThrottleBacklog(1, 1, time.Minute)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started <- struct{}{}
		<-release
		w.WriteHeader(http.StatusOK)
		w.Write(testContent)
	}))

	occupying := serveThrottle(h, httptest.NewRequest(http.MethodGet, "/", nil))
	waitN(t, started, 1)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	queued := &secondDoneContext{Context: ctx, secondDone: make(chan struct{})}
	done := serveThrottle(h, httptest.NewRequest(http.MethodGet, "/", nil).WithContext(queued))
	waitN(t, queued.secondDone, 1)
	cancel()

	rr := waitThrottle(t, done)
	assertEqual(t, http.StatusTooManyRequests, rr.Code)
	assertEqual(t, errContextCanceled, strings.TrimSpace(rr.Body.String()))

	unblock()
	rr = waitThrottle(t, occupying)
	assertEqual(t, http.StatusOK, rr.Code)
	assertEqual(t, testContent, rr.Body.Bytes())
}

func TestThrottleTriggerGatewayTimeout(t *testing.T) {
	started := make(chan struct{}, 1)
	release := make(chan struct{})
	unblock := sync.OnceFunc(func() { close(release) })
	t.Cleanup(unblock)

	h := ThrottleBacklog(1, 1, 50*time.Millisecond)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started <- struct{}{}
		<-release
		w.WriteHeader(http.StatusOK)
		w.Write(testContent)
	}))

	occupying := serveThrottle(h, httptest.NewRequest(http.MethodGet, "/", nil))
	waitN(t, started, 1)

	rr := waitThrottle(t, serveThrottle(h, httptest.NewRequest(http.MethodGet, "/", nil)))
	assertEqual(t, http.StatusTooManyRequests, rr.Code)
	assertEqual(t, errTimedOut, strings.TrimSpace(rr.Body.String()))

	unblock()
	rr = waitThrottle(t, occupying)
	assertEqual(t, http.StatusOK, rr.Code)
	assertEqual(t, testContent, rr.Body.Bytes())
}

func TestThrottleMaximum(t *testing.T) {
	started := make(chan struct{}, 2)
	release := make(chan struct{})
	unblock := sync.OnceFunc(func() { close(release) })
	t.Cleanup(unblock)

	h := ThrottleBacklog(1, 1, time.Minute)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started <- struct{}{}
		<-release
		w.WriteHeader(http.StatusOK)
		w.Write(testContent)
	}))

	occupying := serveThrottle(h, httptest.NewRequest(http.MethodGet, "/", nil))
	waitN(t, started, 1)

	ctx := &secondDoneContext{Context: context.Background(), secondDone: make(chan struct{})}
	queued := serveThrottle(h, httptest.NewRequest(http.MethodGet, "/", nil).WithContext(ctx))
	waitN(t, ctx.secondDone, 1)

	overflowCtx := &secondDoneContext{Context: context.Background(), secondDone: make(chan struct{})}
	overflow := serveThrottle(h, httptest.NewRequest(http.MethodGet, "/", nil).WithContext(overflowCtx))
	timer := time.NewTimer(throttleTestTimeout)
	defer timer.Stop()
	select {
	case <-overflowCtx.secondDone:
		t.Fatal("overflow request entered a full backlog")
	case rr := <-overflow:
		assertEqual(t, http.StatusTooManyRequests, rr.Code)
		assertEqual(t, errCapacityExceeded, strings.TrimSpace(rr.Body.String()))
	case <-timer.C:
		t.Fatal("timed out waiting for backlog overflow rejection")
	}

	unblock()
	for _, done := range []<-chan *httptest.ResponseRecorder{occupying, queued} {
		got := waitThrottle(t, done)
		assertEqual(t, http.StatusOK, got.Code)
		assertEqual(t, testContent, got.Body.Bytes())
	}
}

func TestThrottleRetryAfter(t *testing.T) {
	retryAfterFn := func(ctxDone bool) time.Duration { return time.Hour }
	started := make(chan struct{}, 5)
	release := make(chan struct{})
	unblock := sync.OnceFunc(func() { close(release) })
	t.Cleanup(unblock)

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

	var results []<-chan *httptest.ResponseRecorder
	for range 5 {
		results = append(results, serveThrottle(h, httptest.NewRequest(http.MethodGet, "/", nil)))
	}
	waitN(t, started, 5)

	for range 5 {
		rr := waitThrottle(t, serveThrottle(h, httptest.NewRequest(http.MethodGet, "/", nil)))
		assertEqual(t, http.StatusTooManyRequests, rr.Code)
		assertEqual(t, "3600", rr.Header().Get("Retry-After"))
	}

	unblock()

	for _, done := range results {
		rr := waitThrottle(t, done)
		assertEqual(t, http.StatusOK, rr.Code)
	}
}

func TestThrottleCustomStatusCode(t *testing.T) {
	started := make(chan struct{}, 1)
	release := make(chan struct{})
	unblock := sync.OnceFunc(func() { close(release) })
	t.Cleanup(unblock)

	h := ThrottleWithOpts(ThrottleOpts{Limit: 1, StatusCode: http.StatusServiceUnavailable})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started <- struct{}{}
		<-release
		w.WriteHeader(http.StatusOK)
	}))

	occupying := serveThrottle(h, httptest.NewRequest(http.MethodGet, "/", nil))
	waitN(t, started, 1)

	for range 4 {
		rr := waitThrottle(t, serveThrottle(h, httptest.NewRequest(http.MethodGet, "/", nil)))
		assertEqual(t, http.StatusServiceUnavailable, rr.Code)
		assertEqual(t, errCapacityExceeded, strings.TrimSpace(rr.Body.String()))
	}
	unblock()
	assertEqual(t, http.StatusOK, waitThrottle(t, occupying).Code)
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
