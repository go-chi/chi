package middleware

import (
	"io/ioutil"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/pressly/chi"
	"github.com/stretchr/testify/assert"
)

var testContent = []byte("Hello world!")

func TestThrottleBacklog(t *testing.T) {
	r := chi.NewRouter()

	r.Use(ThrottleBacklog(10, 50, time.Second*10))

	r.Get("/", chi.HFn(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		time.Sleep(time.Second * 1) // Expensive operation.
		w.Write(testContent)
	}))

	server := httptest.NewServer(r)

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
			assert.NoError(t, err)

			assert.Equal(t, http.StatusOK, res.StatusCode)
			buf, err := ioutil.ReadAll(res.Body)
			assert.NoError(t, err)
			assert.Equal(t, testContent, buf)
		}(i)
	}

	wg.Wait()

	server.Close()
}

func TestThrottleClientTimeout(t *testing.T) {
	r := chi.NewRouter()

	r.Use(ThrottleBacklog(10, 50, time.Second*10))

	r.Get("/", chi.HFn(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		time.Sleep(time.Second * 5) // Expensive operation.
		w.Write(testContent)
	}))

	server := httptest.NewServer(r)

	client := http.Client{
		Timeout: time.Second * 3, // Maximum waiting time.
	}

	var wg sync.WaitGroup

	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, err := client.Get(server.URL)
			assert.Error(t, err)
		}(i)
	}

	wg.Wait()

	server.Close()
}

func TestThrottleTriggerGatewayTimeout(t *testing.T) {
	r := chi.NewRouter()

	r.Use(ThrottleBacklog(50, 100, time.Second*5))

	r.Get("/", chi.HFn(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		time.Sleep(time.Second * 10) // Expensive operation.
		w.Write(testContent)
	}))

	server := httptest.NewServer(r)

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
			assert.NoError(t, err)
			assert.Equal(t, http.StatusOK, res.StatusCode)

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
			assert.NoError(t, err)

			buf, err := ioutil.ReadAll(res.Body)
			assert.Equal(t, http.StatusServiceUnavailable, res.StatusCode)
			assert.Equal(t, errTimedOut, strings.TrimSpace(string(buf)))

		}(i)
	}

	wg.Wait()

	server.Close()
}

func TestThrottleMaximum(t *testing.T) {
	r := chi.NewRouter()

	r.Use(ThrottleBacklog(50, 50, time.Second*5))

	r.Get("/", chi.HFn(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		time.Sleep(time.Second * 2) // Expensive operation.
		w.Write(testContent)
	}))

	server := httptest.NewServer(r)

	client := http.Client{
		Timeout: time.Second * 60, // Maximum waiting time.
	}

	var wg sync.WaitGroup

	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()

			res, err := client.Get(server.URL)
			assert.NoError(t, err)
			assert.Equal(t, http.StatusOK, res.StatusCode)

			buf, err := ioutil.ReadAll(res.Body)
			assert.NoError(t, err)
			assert.Equal(t, testContent, buf)

		}(i)
	}

	// Wait less time than what the server takes to reply.
	time.Sleep(time.Second * 1)

	// At this point the server is still processing, all the following request
	// will be beyond the server capacity.
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()

			res, err := client.Get(server.URL)
			assert.NoError(t, err)

			buf, err := ioutil.ReadAll(res.Body)
			assert.Equal(t, http.StatusServiceUnavailable, res.StatusCode)
			assert.Equal(t, errCapacityExceeded, strings.TrimSpace(string(buf)))

		}(i)
	}

	wg.Wait()

	server.Close()
}
