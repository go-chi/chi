# <img alt="chi" src="https://cdn.rawgit.com/pressly/chi/master/_examples/chi.svg" width="220" />


[![GoDoc Widget]][GoDoc] [![Travis Widget]][Travis]

`chi` is a lightweight, idiomatic and composable router for building Go 1.7+ HTTP services. It's
especially good at helping you write large REST API services that are kept maintainable as your
project grows and changes. `chi` is built on the new `context` package introduced in Go 1.7 to
handle signaling, cancelation and request-scoped values across a handler chain.

The focus of the project has been to seek out an elegant and comfortable design for writing
REST API servers, written during the development of the Pressly API service that powers our
public API service, which in turn powers all of our client-side applications.

The key considerations of chi's design are: project structure, maintainability, standard http
handlers (stdlib-only), developer productivity, and deconstructing a large system into many small
parts. The core router `github.com/pressly/chi` is quite small (less than 1000 LOC), but we've also
included some useful/optional subpackages: `middleware`, `render` and `docgen`. We hope you enjoy it too!

## Install

`go get -u github.com/pressly/chi`


## Features

* **Lightweight** - cloc'd in <1000 LOC for the chi router
* **Fast** - yes, see [benchmarks](#benchmarks)
* **100% compatible with net/http** - use any http or middleware pkg in the ecosystem that is also compat with `net/http`
* **Designed for modular/composable APIs** - middlewares, inline middlewares, route groups and subrouter mounting
* **Context control** - built on new `context` package, providing value chaining, cancelations and timeouts
* **Robust** - tested / used in production at Pressly.com, and many others
* **Doc generation** - `docgen` auto-generates routing documentation from your source to JSON or Markdown
* **No external dependencies** - plain ol' Go 1.7+ stdlib + net/http


## Examples

* [rest](https://github.com/pressly/chi/blob/master/_examples/rest/main.go) - REST APIs made easy, productive and maintainable
* [logging](https://github.com/pressly/chi/blob/master/_examples/logging/main.go) - Easy structured logging for any backend
* [limits](https://github.com/pressly/chi/blob/master/_examples/limits/main.go) - Timeouts and Throttling
* [todos-resource](https://github.com/pressly/chi/blob/master/_examples/todos-resource/main.go) - Struct routers/handlers, an example of another code layout style
* [versions](https://github.com/pressly/chi/blob/master/_examples/versions/main.go) - Demo of `chi/render` subpkg
* [fileserver](https://github.com/pressly/chi/blob/master/_examples/fileserver/main.go) - Easily serve static files
* [graceful](https://github.com/pressly/chi/blob/master/_examples/graceful/main.go) - Graceful context signaling and server shutdown


**As easy as:**

```go
package main

import (
	"net/http"
	"github.com/pressly/chi"
)

func main() {
	r := chi.NewRouter()
	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("welcome"))
	})
	http.ListenAndServe(":3000", r)
}
```

**REST Preview:**

Here is a little preview of how routing looks like with chi. Also take a look at the generated routing docs
in JSON ([routes.json](https://github.com/pressly/chi/blob/master/_examples/rest/routes.json)) and in
Markdown ([routes.md](https://github.com/pressly/chi/blob/master/_examples/rest/routes.md)).

I highly recommend reading the source of the [examples](#examples) listed above, they will show you all the features
of chi and serve as a good form of documentation.

```go
import (
  //...
  "context"
  "github.com/pressly/chi"
  "github.com/pressly/chi/middleware"
)

func main() {
  r := chi.NewRouter()

  // A good base middleware stack
  r.Use(middleware.RequestID)
  r.Use(middleware.RealIP)
  r.Use(middleware.Logger)
  r.Use(middleware.Recoverer)

  // When a client closes their connection midway through a request, the
  // http.CloseNotifier will cancel the request context (ctx).
  r.Use(middleware.CloseNotify)

  // Set a timeout value on the request context (ctx), that will signal
  // through ctx.Done() that the request has timed out and further
  // processing should be stopped.
  r.Use(middleware.Timeout(60 * time.Second))

  r.Get("/", func(w http.ResponseWriter, r *http.Request) {
    w.Write([]byte("hi"))
  })

  // RESTy routes for "articles" resource
  r.Route("/articles", func(r chi.Router) {
    r.With(paginate).Get("/", listArticles)  // GET /articles
    r.Post("/", createArticle)               // POST /articles
    r.Get("/search", searchArticles)         // GET /articles/search

    r.Route("/:articleID", func(r chi.Router) {
      r.Use(ArticleCtx)
      r.Get("/", getArticle)                 // GET /articles/123
      r.Put("/", updateArticle)              // PUT /articles/123
      r.Delete("/", deleteArticle)           // DELETE /articles/123
    })
  })

  // Mount the admin sub-router
  r.Mount("/admin", adminRouter())

  http.ListenAndServe(":3333", r)
}

func ArticleCtx(next http.Handler) http.Handler {
  return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
    articleID := chi.URLParam(r, "articleID")
    article, err := dbGetArticle(articleID)
    if err != nil {
      http.Error(w, http.StatusText(404), 404)
      return
    }
    ctx := context.WithValue(r.Context(), "article", article)
    next.ServeHTTP(w, r.WithContext(ctx))
  })
}

func getArticle(w http.ResponseWriter, r *http.Request) {
  ctx := r.Context()
  article, ok := ctx.Value("article").(*Article)
  if !ok {
    http.Error(w, http.StatusText(422), 422)
    return
  }
  w.Write([]byte(fmt.Sprintf("title:%s", article.Title)))
}

// A completely separate router for administrator routes
func adminRouter() http.Handler {
  r := chi.NewRouter()
  r.Use(AdminOnly)
  r.Get("/", adminIndex)
  r.Get("/accounts", adminListAccounts)
  return r
}

func AdminOnly(next http.Handler) http.Handler {
  return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    perm, ok := ctx.Value("acl.permission").(YourPermissionType)
    if !ok || !perm.IsAdmin() {
      http.Error(w, http.StatusText(403), 403)
      return
    }
    next.ServeHTTP(w, r)
  })
}
```


## Router design

chi's router is based on a kind of [Patricia Radix trie](https://en.wikipedia.org/wiki/Radix_tree).
The router is fully compatible with `net/http`.

Built on top of the tree is the `Router` interface:

```go
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
}

// Routes interface adds two methods for router traversal, which is also
// used by the `docgen` subpackage to generation documentation for Routers.
type Routes interface {
	// Routes returns the routing tree in an easily traversable structure.
	Routes() []Route

	// Middlewares returns the list of middlewares in use by the router.
	Middlewares() Middlewares
}
```

Each routing method accepts a URL `pattern` and chain of `handlers`. The URL pattern
supports named params (ie. `/users/:userID`) and wildcards (ie. `/admin/*`). URL parameters
can be fetched at runtime by calling `chi.URLParam(r, "userID")` for named parameters
and `chi.URLParam(r, "*")` for a wildcard parameter.


### Middleware handlers

chi's middlewares are just stdlib net/http middleware handlers. There is nothing special
about them, which means the router and all the tooling is designed to be compatible and
friendly with any middleware in the community. This offers much better extensibility and reuse
of packages and is at the heart of chi's purpose.

Here is an example of a standard net/http middleware handler using the new request context
available in Go 1.7+. This middleware sets a hypothetical user identifier on the request
context and calls the next handler in the chain.

```go
// HTTP middleware setting a value on the request context
func MyMiddleware(next http.Handler) http.Handler {
  return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
    ctx := context.WithValue(r.Context(), "user", "123")
    next.ServeHTTP(w, r.WithContext(ctx))
  })
}
```


### Request handlers

chi uses standard net/http request handlers. This little snippet is an example of a http.Handler
func that reads a user identifier from the request context - hypothetically, identifying
the user sending an authenticated request, validated+set by a previous middleware handler.

```go
// HTTP handler accessing data from the request context.
func MyRequestHandler(w http.ResponseWriter, r *http.Request) {
  user := r.Context().Value("user").(string)
  w.Write([]byte(fmt.Sprintf("hi %s", user)))
}
```


### URL parameters

chi's router parses and stores URL parameters right onto the request context. Here is
an example of how to access URL params in your net/http handlers. And of course, middlewares
are able to access the same information.

```go
// HTTP handler accessing the url routing parameters.
func MyRequestHandler(w http.ResponseWriter, r *http.Request) {
  userID := chi.URLParam(r, "userID") // from a route like /users/:userID

  ctx := r.Context()
  key := ctx.Value("key").(string)

  w.Write([]byte(fmt.Sprintf("hi %v, %v", userID, key)))
}
```


## Middlewares

chi comes equipped with an optional `middleware` package, providing a suite of standard
`net/http` middlewares. Please note, any middleware in the ecosystem that is also compatible
with `net/http` can be used with chi's mux.

----------------------------------------------------------------------------------------------------------
| Middleware           | Description                                                                     |
|:---------------------|:---------------------------------------------------------------------------------
| RequestID            | Injects a request ID into the context of each request.                          |
| RealIP               | Sets a http.Request's RemoteAddr to either X-Forwarded-For or X-Real-IP.        |
| Logger               | Logs the start and end of each request with the elapsed processing time.        |
| Recoverer            | Gracefully absorb panics and prints the stack trace.                            |
| NoCache              | Sets response headers to prevent clients from caching.                          |
| Timeout              | Signals to the request context when the timeout deadline is reached.            |
| Throttle             | Puts a ceiling on the number of concurrent requests.                            |
| Compress             | Gzip compression for clients that accept compressed responses.                  |
| Profiler             | Easily attach net/http/pprof to your routers.                                   |
| StripSlashes         | Strip slashes on routing paths.                                                 |
| RedirectSlashes      | Redirect slashes on routing paths.                                              |
| WithValue            | Short-hand middleware to set a key/value on the request context.                |
| Heartbeat            | Monitoring endpoint to check the servers pulse.                                 |
----------------------------------------------------------------------------------------------------------

Other cool net/http middlewares:

* [jwtauth](https://github.com/goware/jwtauth) - JWT authenticator
* [cors](https://github.com/goware/cors) - CORS middleware
* [httpcoala](https://github.com/goware/httpcoala) - Request coalescer

please [submit a PR](./CONTRIBUTING.md) if you'd like to include a link to a chi middleware


## context?

`context` is a tiny pkg that provides simple interface to signal context across call stacks
and goroutines. It was originally written by [Sameer Ajmani](https://github.com/Sajmani)
and is available in stdlib since go1.7.

Learn more at https://blog.golang.org/context

and..
* Docs: https://golang.org/pkg/context
* Source: https://github.com/golang/go/tree/master/src/context


## Benchmarks

The benchmark suite: https://github.com/pkieltyka/go-http-routing-benchmark

Comparison with other routers (as of Jan 7/17): https://gist.github.com/pkieltyka/d0814d5396c996cb3ff8076399583d1f

```shell
BenchmarkChi_Param        	 5000000	       398 ns/op	     304 B/op	       2 allocs/op
BenchmarkChi_Param5       	 3000000	       556 ns/op	     304 B/op	       2 allocs/op
BenchmarkChi_Param20      	 1000000	      1184 ns/op	     304 B/op	       2 allocs/op
BenchmarkChi_ParamWrite   	 3000000	       443 ns/op	     304 B/op	       2 allocs/op
BenchmarkChi_GithubStatic 	 3000000	       427 ns/op	     304 B/op	       2 allocs/op
BenchmarkChi_GithubParam  	 3000000	       565 ns/op	     304 B/op	       2 allocs/op
BenchmarkChi_GithubAll    	   10000	    122143 ns/op	   61716 B/op	     406 allocs/op
BenchmarkChi_GPlusStatic  	 5000000	       383 ns/op	     304 B/op	       2 allocs/op
BenchmarkChi_GPlusParam   	 3000000	       431 ns/op	     304 B/op	       2 allocs/op
BenchmarkChi_GPlus2Params 	 3000000	       500 ns/op	     304 B/op	       2 allocs/op
BenchmarkChi_GPlusAll     	  200000	      6410 ns/op	    3952 B/op	      26 allocs/op
BenchmarkChi_ParseStatic  	 5000000	       384 ns/op	     304 B/op	       2 allocs/op
BenchmarkChi_ParseParam   	 3000000	       415 ns/op	     304 B/op	       2 allocs/op
BenchmarkChi_Parse2Params 	 3000000	       450 ns/op	     304 B/op	       2 allocs/op
BenchmarkChi_ParseAll     	  100000	     12124 ns/op	    7904 B/op	      52 allocs/op
BenchmarkChi_StaticAll    	   20000	     78501 ns/op	   47731 B/op	     314 allocs/op
```

NOTE: the allocs in the benchmark above are from the calls to http.Request's
`WithContext(context.Context)` method that clones the http.Request, sets the `Context()`
on the duplicated (alloc'd) request and returns it the new request object. This is just
how setting context on a request in Go 1.7+ works.


## Credits

* Carl Jackson for https://github.com/zenazn/goji
  * Parts of chi's thinking comes from goji, and chi's middleware package
    sources from goji.
* Armon Dadgar for https://github.com/armon/go-radix
* Contributions: [@VojtechVitek](https://github.com/VojtechVitek)

We'll be more than happy to see [your contributions](./CONTRIBUTING.md)!


## Beyond REST

chi is just a http router that lets you decompose request handling into many smaller layers.
Many companies including Pressly.com (of course) use chi to write REST services for their public
APIs. But, REST is just a convention for managing state via HTTP, and there's a lot of other pieces
required to write a complete client-server system or network of microservices.

Looking ahead beyond REST, I also recommend some newer works in the field coming from
[gRPC](https://github.com/grpc/grpc-go), [NATS](https://nats.io), [go-kit](https://github.com/go-kit/kit)
and even [graphql](https://github.com/graphql-go/graphql). They're all pretty cool with their
own unique approaches and benefits. Specifically, I'd look at gRPC since it makes client-server
communication feel like a single program on a single computer, no need to hand-write a client library
and the request/response payloads are typed contracts. NATS is pretty amazing too as a super
fast and lightweight pub-sub transport that can speak protobufs, with nice service discovery -
an excellent combination with gRPC.


## License

Copyright (c) 2015-present [Peter Kieltyka](https://github.com/pkieltyka)

Licensed under [MIT License](./LICENSE)

[GoDoc]: https://godoc.org/github.com/pressly/chi
[GoDoc Widget]: https://godoc.org/github.com/pressly/chi?status.svg
[Travis]: https://travis-ci.org/pressly/chi
[Travis Widget]: https://travis-ci.org/pressly/chi.svg?branch=master
