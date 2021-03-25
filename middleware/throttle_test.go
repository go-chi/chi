package middleware

import (
	"io/ioutil"
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

	// The throttler proccesses 10 consecutive requests, each one of those
	// requests lasts 1s. The maximum number of requests this can possible serve
	// before the clients time out (5s) is 40.
	for i := 0; i < 40; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()

			res, err := client.Get(server.URL)
			assertNoError(t, err)

			assertEqual(t, http.StatusOK, res.StatusCode)
			buf, err := ioutil.ReadAll(res.Body)
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

	for i := 0; i < 10; i++ {
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
	for i := 0; i < 50; i++ {
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
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()

			res, err := client.Get(server.URL)
			assertNoError(t, err)

			buf, err := ioutil.ReadAll(res.Body)
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

	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()

			res, err := client.Get(server.URL)
			assertNoError(t, err)
			assertEqual(t, http.StatusOK, res.StatusCode)

			buf, err := ioutil.ReadAll(res.Body)
			assertNoError(t, err)
			assertEqual(t, testContent, buf)

		}(i)
	}

	// Wait less time than what the server takes to reply.
	time.Sleep(time.Second * 2)

	// At this point the server is still processing, all the following request
	// will be beyond the server capacity.
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()

			res, err := client.Get(server.URL)
			assertNoError(t, err)

			buf, err := ioutil.ReadAll(res.Body)
			assertNoError(t, err)
			assertEqual(t, http.StatusTooManyRequests, res.StatusCode)
			assertEqual(t, errCapacityExceeded, strings.TrimSpace(string(buf)))

		}(i)
	}

	wg.Wait()
}

func TestThrottleRetryAfter(t *testing.T) {
	r := chi.NewRouter()

	retryAfterFn := func(ctxDone bool) time.Duration { return time.Hour * 1 }
	r.Use(ThrottleWithOpts(ThrottleOpts{Limit: 10, RetryAfterFn: retryAfterFn}))

	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		time.Sleep(time.Second * 4) // Expensive operation.
		w.Write(testContent)
	})

	server := httptest.NewServer(r)
	defer server.Close()

	client := http.Client{
		Timeout: time.Second * 60, // Maximum waiting time.
	}

	var wg sync.WaitGroup

	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()

			res, err := client.Get(server.URL)
			assertNoError(t, err)
			assertEqual(t, http.StatusOK, res.StatusCode)
		}(i)
	}

	time.Sleep(time.Second * 1)

	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()

			res, err := client.Get(server.URL)
			assertNoError(t, err)
			assertEqual(t, http.StatusTooManyRequests, res.StatusCode)
			assertEqual(t, res.Header.Get("Retry-After"), "3600")
		}(i)
	}

	wg.Wait()
}
