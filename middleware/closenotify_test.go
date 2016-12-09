package middleware

import (
	"io/ioutil"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/pressly/chi"
)

func TestCloseNotify(t *testing.T) {
	testContent := []byte("hi")

	r := chi.NewRouter()
	r.Use(CloseNotify)
	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		w.Write(testContent)
	})

	server := httptest.NewServer(r)

	var wg sync.WaitGroup

	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()

			res, err := http.Get(server.URL)
			assertNoError(t, err)

			assertEqual(t, http.StatusOK, res.StatusCode)
			buf, err := ioutil.ReadAll(res.Body)
			assertNoError(t, err)
			assertEqual(t, testContent, buf)
		}(i)
	}

	wg.Wait()

	server.Close()
}
