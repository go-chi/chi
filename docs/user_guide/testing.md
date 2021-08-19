# 🧪 Testing

Writing tests for APIs is easy. We can use the inbuilt `net/http/httptest` lib to test our apis.

### Usage
First we will create a simple Hello World Api
```go
package main

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

func main() {
	s := CreateNewServer()
	s.MountHandlers()
	http.ListenAndServe(":3000", s.Router)
}

// HelloWorld api Handler
func HelloWorld(w http.ResponseWriter, r *http.Request) {
	w.Write([]byte("Hello World!"))
}

type Server struct {
	Router *chi.Mux
	// Db, config can be added here
}

func CreateNewServer() *Server {
	s := &Server{}
	s.Router = chi.NewRouter()
	return s
}

func (s *Server) MountHandlers() {
	// Mount all Middleware here
	s.Router.Use(middleware.Logger)

	// Mount all handlers here
	s.Router.Get("/", HelloWorld)

}
```
This is how a standard api would look, with a `Server` struct where we can add our router, and database connection...etc.

We then write a `CreateNewServer` function to return a New Server with a `chi.Mux` Router

We can then Mount all Handlers and middlewares in a single server method `MountHandlers`


We can now start writing tests for this.

When writing tests, we will assert what values our api will return

So for the route `/` our api should return `Hello World!` and a status code of `200`


Now in another file `main_test.go`
```go
package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/stretchr/testify/require"
)

// executeRequest, creates a new ResponseRecorder
// then executes the request by calling ServeHTTP in the router
// after which the handler writes the response to the response recorder
// which we can then inspect.
func executeRequest(req *http.Request, s *Server) *httptest.ResponseRecorder {
	rr := httptest.NewRecorder()
	s.Router.ServeHTTP(rr, req)

	return rr
}

// checkResponseCode is a simple utility to check the response code
// of the response
func checkResponseCode(t *testing.T, expected, actual int) {
	if expected != actual {
		t.Errorf("Expected response code %d. Got %d\n", expected, actual)
	}
}

func TestHelloWorld(t *testing.T) {
    // Create a New Server Struct
	s := CreateNewServer()
    // Mount Handlers
	s.MountHandlers()

    // Create a New Request
	req, _ := http.NewRequest("GET", "/", nil)

    // Execute Request
	response := executeRequest(req, s)

    // Check the response code
	checkResponseCode(t, http.StatusOK, response.Code)

    // We can use testify/require to assert values, as it is more convenient
	require.Equal(t, "Hello World!", response.Body.String())
}
```

Now run `go test ./... -v -cover`  <br>

Voila, your tests work now.