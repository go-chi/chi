## Installation

`go get -u github.com/go-chi/chi/v5`


## Running a Simple Server

The simplest Hello World Api Can look like this.

```go
package main

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

func main() {
	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("Hello World!"))
	})
	http.ListenAndServe(":3000", r)
}
```
```sh
go run main.go
```
Browse to `http://localhost:3000`, and you should see `Hello World!` on the page.
