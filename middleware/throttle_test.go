package middleware

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
)

var testContent = []byte("Hello world!")

func TestThrottleBacklog(t *testing.T) {
	r := chi.NewRouter()

	r.Use(ThrottleBacklog(10, 50, time.Second*10))

	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		time.Sleep(time.Second * 1) // Expensive operation.
		w.Write(testContent)
	})

	server := httptest.NewServer(r)
	defer server.Close()

	client := http.Client{
		Timeout: time.Second * 5, // Maximum waiting time.
	}

	var wg sync.WaitGroup

	// The throttler processes 10 consecutive requests, each one of those
	// requests lasts 1s. The maximum number of requests this can possible serve
	// before the clients time out (5s) is 40.
	for i := range 40 {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()

			res, err := client.Get(server.URL)
			assertNoError(t, err)

			assertEqual(t, http.StatusOK, res.StatusCode)
			buf, err := io.ReadAll(res.Body)
			assertNoError(t, err)
			assertEqual(t, testContent, buf)
		}(i)
	}

	wg.Wait()
}

func TestThrottleClientTimeout(t *testing.T) {
	r := chi.NewRouter()

	r.Use(ThrottleBacklog(10, 50, time.Second*10))

	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		time.Sleep(time.Second * 5) // Expensive operation.
		w.Write(testContent)
	})

	server := httptest.NewServer(r)
	defer server.Close()

	client := http.Client{
		Timeout: time.Second * 3, // Maximum waiting time.
	}

	var wg sync.WaitGroup

	for i := range 10 {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, err := client.Get(server.URL)
			assertError(t, err)
		}(i)
	}

	wg.Wait()
}

func TestThrottleTriggerGatewayTimeout(t *testing.T) {
	r := chi.NewRouter()

	r.Use(ThrottleBacklog(50, 100, time.Second*5))

	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		time.Sleep(time.Second * 10) // Expensive operation.
		w.Write(testContent)
	})

	server := httptest.NewServer(r)
	defer server.Close()

	client := http.Client{
		Timeout: time.Second * 60, // Maximum waiting time.
	}

	var wg sync.WaitGroup

	// These requests will be processed normally until they finish.
	for i := range 50 {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()

			res, err := client.Get(server.URL)
			assertNoError(t, err)
			assertEqual(t, http.StatusOK, res.StatusCode)
		}(i)
	}

	time.Sleep(time.Second * 1)

	// These requests will wait for the first batch to complete but it will take
	// too much time, so they will eventually receive a timeout error.
	for i := range 50 {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()

			res, err := client.Get(server.URL)
			assertNoError(t, err)

			buf, err := io.ReadAll(res.Body)
			assertNoError(t, err)
			assertEqual(t, http.StatusTooManyRequests, res.StatusCode)
			assertEqual(t, errTimedOut, strings.TrimSpace(string(buf)))
		}(i)
	}

	wg.Wait()
}

func TestThrottleMaximum(t *testing.T) {
	r := chi.NewRouter()

	r.Use(ThrottleBacklog(10, 10, time.Second*5))

	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		time.Sleep(time.Second * 3) // Expensive operation.
		w.Write(testContent)
	})

	server := httptest.NewServer(r)
	defer server.Close()

	client := http.Client{
		Timeout: time.Second * 60, // Maximum waiting time.
	}

	var wg sync.WaitGroup

	for i := range 20 {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()

			res, err := client.Get(server.URL)
			assertNoError(t, err)
			assertEqual(t, http.StatusOK, res.StatusCode)

			buf, err := io.ReadAll(res.Body)
			assertNoError(t, err)
			assertEqual(t, testContent, buf)
		}(i)
	}

	// Wait less time than what the server takes to reply.
	time.Sleep(time.Second * 2)

	// At this point the server is still processing, all the following request
	// will be beyond the server capacity.
	for i := range 20 {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()

			res, err := client.Get(server.URL)
			assertNoError(t, err)

			buf, err := io.ReadAll(res.Body)
			assertNoError(t, err)
			assertEqual(t, http.StatusTooManyRequests, res.StatusCode)
			assertEqual(t, errCapacityExceeded, strings.TrimSpace(string(buf)))
		}(i)
	}

	wg.Wait()
}

func TestThrottleRetryAfter(t *testing.T) {
	const limit = 5
	const total = 10

	retryAfterFn := func(ctxDone bool) time.Duration { return time.Hour }
	throttled := ThrottleWithOpts(ThrottleOpts{Limit: limit, RetryAfterFn: retryAfterFn})

	// Each accepted request is held open until the test lets it go, so the
	// limit tokens stay taken no matter how the runtime schedules things.
	release := make(chan struct{})
	served := make(chan struct{}, limit)
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		served <- struct{}{}
		<-release
		w.WriteHeader(http.StatusOK)
	})
	handler := throttled(next)

	// Take the limit tokens first and wait until they are all held.
	var wg sync.WaitGroup
	accepted := make(chan *httptest.ResponseRecorder, limit)
	for i := 0; i < limit; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
			accepted <- rec
		}()
	}
	for i := 0; i < limit; i++ {
		<-served
	}

	// Requests beyond the limit are rejected right away with Retry-After.
	rejected := make(chan *httptest.ResponseRecorder, total-limit)
	for i := 0; i < total-limit; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
			rejected <- rec
		}()
	}
	for i := 0; i < total-limit; i++ {
		rec := <-rejected
		assertEqual(t, http.StatusTooManyRequests, rec.Code)
		assertEqual(t, "3600", rec.Header().Get("Retry-After"))
	}

	close(release)
	wg.Wait()

	// The held requests finished once released, all of them served normally.
	for i := 0; i < limit; i++ {
		rec := <-accepted
		assertEqual(t, http.StatusOK, rec.Code)
	}
}

func TestThrottleRetryAfterCancelled(t *testing.T) {
	// retryAfterFn lets the two Retry-After sources be told apart, a cancelled
	// context is "done" while hitting the limit is not.
	retryAfterFn := func(ctxDone bool) time.Duration {
		if ctxDone {
			return 2 * time.Hour
		}
		return time.Hour
	}
	throttled := ThrottleWithOpts(ThrottleOpts{
		Limit:          1,
		BacklogLimit:   1,
		BacklogTimeout: time.Hour,
		RetryAfterFn:   retryAfterFn,
	})

	release := make(chan struct{})
	served := make(chan struct{}, 1)
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		served <- struct{}{}
		<-release
	})
	handler := throttled(next)

	// Hold the single token with an in-flight request.
	firstDone := make(chan struct{})
	go func() {
		defer close(firstDone)
		handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))
	}()
	<-served

	// A second request has to wait in the backlog. Cancel its context and the
	// middleware must reply with the "done" variant of Retry-After. Depending
	// on scheduling, the cancellation may fire before the request reaches the
	// first select (direct cancel branch) or while it waits in the backlog
	// (backlog cancel branch). Both paths set the header the same way, so the
	// assertion below holds either way.
	ctx, cancel := context.WithCancel(context.Background())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil).WithContext(ctx)
	secondDone := make(chan struct{})
	go func() {
		defer close(secondDone)
		handler.ServeHTTP(rec, req)
	}()
	cancel()
	<-secondDone

	assertEqual(t, http.StatusTooManyRequests, rec.Code)
	assertEqual(t, "7200", rec.Header().Get("Retry-After"))

	close(release)
	<-firstDone
}

func TestThrottleRetryAfterBacklogTimeout(t *testing.T) {
	// A request that gets a backlog token but no processing token in time
	// hits the backlog timeout branch, which reports Retry-After with
	// ctxDone=false (it is a timeout, not a cancellation).
	retryAfterFn := func(ctxDone bool) time.Duration {
		if ctxDone {
			return 2 * time.Hour
		}
		return time.Hour
	}
	throttled := ThrottleWithOpts(ThrottleOpts{
		Limit:          1,
		BacklogLimit:   1,
		BacklogTimeout: 10 * time.Millisecond,
		RetryAfterFn:   retryAfterFn,
	})

	release := make(chan struct{})
	served := make(chan struct{}, 1)
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		served <- struct{}{}
		<-release
	})
	handler := throttled(next)

	// Hold the single token with an in-flight request.
	firstDone := make(chan struct{})
	go func() {
		defer close(firstDone)
		handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))
	}()
	<-served

	// A second request gets the backlog token, finds no processing token and
	// times out waiting for one.
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	assertEqual(t, http.StatusTooManyRequests, rec.Code)
	assertEqual(t, "3600", rec.Header().Get("Retry-After"))

	close(release)
	<-firstDone
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

	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
	}
}
