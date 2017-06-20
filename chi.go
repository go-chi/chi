//
// Package chi is a small, idiomatic and composable router for building HTTP services.
//
// chi requires Go 1.7 or newer.
//
// Example:
//  package main
//
//  import (
//  	"net/http"
//
//  	"github.com/pressly/chi"
//  	"github.com/pressly/chi/middleware"
//  )
//
//  func main() {
//  	r := chi.NewRouter()
//  	r.Use(middleware.Logger)
//  	r.Use(middleware.Recoverer)
//
//  	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
//  		w.Write([]byte("root."))
//  	})
//
//  	http.ListenAndServe(":3333", r)
//  }
//
// See github.com/pressly/chi/_examples/ for more in-depth examples.
//
package chi

import "net/http"

// NewRouter returns a new Mux object that implements the Router interface.
func NewRouter() *Mux {
	return NewMux()
}

// Router consisting of the core routing methods used by chi's Mux,
// using only the standard net/http.
type Router interface {
	http.Handler
	Routes

	// Use appends one of more middlewares onto the Router stack.
	Use(middlewares ...func(http.Handler) http.Handler)

	// With adds inline middlewares for an endpoint handler.
	With(middlewares ...func(http.Handler) http.Handler) Router

	// Group adds a new inline-Router along the current routing
	// path, with a fresh middleware stack for the inline-Router.
	Group(fn func(r Router)) Router

	// Route mounts a sub-Router along a `pattern`` string.
	Route(pattern string, fn func(r Router)) Router

	// Mount attaches another http.Handler along ./pattern/*
	Mount(pattern string, h http.Handler)

	// Handle and HandleFunc adds routes for `pattern` that matches
	// all HTTP methods.
	Handle(pattern string, h http.Handler)
	HandleFunc(pattern string, h http.HandlerFunc)

	// Method and MethodFunc adds routes for `pattern` that matches
	// the `method` HTTP method.
	Method(method, pattern string, h http.Handler)
	MethodFunc(method, pattern string, h http.HandlerFunc)

	// HTTP-method routing along `pattern`
	Connect(pattern string, h http.HandlerFunc)
	Delete(pattern string, h http.HandlerFunc)
	Get(pattern string, h http.HandlerFunc)
	Head(pattern string, h http.HandlerFunc)
	Options(pattern string, h http.HandlerFunc)
	Patch(pattern string, h http.HandlerFunc)
	Post(pattern string, h http.HandlerFunc)
	Put(pattern string, h http.HandlerFunc)
	Trace(pattern string, h http.HandlerFunc)

	// NotFound defines a handler to respond whenever a route could
	// not be found.
	NotFound(h http.HandlerFunc)

	// MethodNotAllowed defines a handler to respond whenever a method is
	// not allowed.
	MethodNotAllowed(h http.HandlerFunc)
}

// Routes interface adds two methods for router traversal, which is also
// used by the `docgen` subpackage to generation documentation for Routers.
type Routes interface {
	// Routes returns the routing tree in an easily traversable structure.
	Routes() []Route

	// Middlewares returns the list of middlewares in use by the router.
	Middlewares() Middlewares
}

// Middlewares type is a slice of standard middleware handlers with methods
// to compose middleware chains and http.Handler's.
type Middlewares []func(http.Handler) http.Handler
