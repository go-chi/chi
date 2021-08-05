<!-- docs/quickstart.md -->

# Quick Start

This tutorial shows how to use `chi` in your project step by step.


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

## Adding More Middleware and Url Patterns
```go
package main

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)


func main(){
	r := chi.NewRouter()
	

	r.Use(middleware.RequestID)
	// RealIP is a middleware that sets a http.Request's RemoteAddr to the results
	// of parsing either the X-Real-IP header or the X-Forwarded-For header (in that
	// order).
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	// Recoverer is a middleware that recovers from panics, logs the panic (and a
	// backtrace), and returns a HTTP 500 (Internal Server Error) status if
	// possible. Recoverer prints a request ID if one is provided.
	r.Use(middleware.Recoverer)
	
	r.Use(middleware.CleanPath)

	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("Hello World!"))
	})

}
```