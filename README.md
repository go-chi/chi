<img alt="chi" src="https://raw.githubusercontent.com/pressly/chi/master/_examples/chi.svg" width="220" />
===

[![GoDoc Widget]][GoDoc] [![Travis Widget]][Travis]

`chi` is a lightweight, idiomatic and composable router for building Go 1.7+ HTTP services. It's
especially good at helping you write large REST API services that are kept maintainable as your
project grows and changes. `chi` is built on the new `context` package introduced in Go 1.7 to
handle signaling, cancelation and request-scoped values across a handler chain.

The focus of the project has been to seek out an elegant and comfortable design for writing
REST API servers, written during the development of the Pressly API service that powers our
network of services.

The key considerations of chi's design are: project structure, maintainability, standard http
handlers (stdlib-only), developer productivity, and deconstructing a large system into many small
parts. The core router `github.com/pressly/chi` is quite small (less than 1000 LOC), but we've also
included some useful/optional subpackages: `middleware`, `render` and `docgen`. We hope you enjoy it too!


## Features

* **Lightweight** - cloc'd in <1000 LOC for the chi router
* **Fast** - yes, see [benchmarks](#benchmarks)
* **Designed for modular/composable APIs** - middlewares, inline middlewares, route groups and subrouter mounting
* **Context control** - built on new `context` package, providing value chaining, cancelations and timeouts
* **Robust** - tested / used in production at Pressly.com, and many others
* **Doc generation** - `docgen` auto-generates routing documentation from your source
* **No external dependencies** - plain ol' Go 1.7+ stdlib + net/http


## Examples

Examples:
* [rest](https://github.com/pressly/chi/blob/master/_examples/rest/main.go) - REST APIs made easy, productive and maintainable
* [limits](https://github.com/pressly/chi/blob/master/_examples/limits/main.go) - Timeouts and Throttling
* [todos-resource](https://github.com/pressly/chi/blob/master/_examples/todos-resource/main.go) - Struct routers/handlers, an example of another code layout style
* [versions](https://github.com/pressly/chi/blob/master/_examples/versions/main.go) - Demo of `chi/render` subpkg
* [fileserver](https://github.com/pressly/chi/blob/master/_examples/fileserver/main.go) - Easily serve static files

Preview:

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

Chi's router is based on a kind of [Patricia Radix trie](https://en.wikipedia.org/wiki/Radix_tree).
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
supports named params (ie. `/users/:userID`) and wildcards (ie. `/admin/*`).


### Middleware handlers

```go
// HTTP middleware setting a value on the request context
func Middleware(next http.Handler) http.Handler {
  return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
    ctx := context.WithValue(r.Context(), "user", "123")
    next.ServeHTTP(w, r.WithContext(ctx))
  })
}
```


### Request handlers

```go
// HTTP handler accessing data from the request context.
func Handler(w http.ResponseWriter, r *http.Request) {
  user := r.Context().Value("user").(string)
  w.Write([]byte(fmt.Sprintf("hi %s", user)))
}
```

```go
// HTTP handler accessing the url routing parameters.
func CtxHandler(w http.ResponseWriter, r *http.Request) {
  userID := chi.URLParam(r, "userID") // from a route like /users/:userID

  ctx := r.Context()
  key := ctx.Value("key").(string)

  w.Write([]byte(fmt.Sprintf("hi %v, %v", userID, key)))
}
```


## Middlewares

Chi comes equipped with an optional `middleware` package, providing:

--------------------------------------------------------------------------------------------------
| Middleware   | Description                                                                     |
|:-------------|:---------------------------------------------------------------------------------
| RequestID    | Injects a request ID into the context of each request.                          |
| RealIP       | Sets a http.Request's RemoteAddr to either X-Forwarded-For or X-Real-IP.        |
| Logger       | Logs the start and end of each request with the elapsed processing time.        |
| Recoverer    | Gracefully absorb panics and prints the stack trace.                            |
| NoCache      | Sets response headers to prevent clients from caching.                          |
| CloseNotify  | Signals to the request context when a client has closed their connection.       |
| Timeout      | Signals to the request context when the timeout deadline is reached.            |
| Throttle     | Puts a ceiling on the number of concurrent requests.                            |
| Compress     | Gzip compression for clients that accept compressed responses.                  |
| Profiler     | Easily attach net/http/pprof to your routers.                                   |
| Slashes      | Strip and redirect slashes on routing paths.                                    |
| WithValue    | Short-hand middleware to set a key/value on the request context.                |
--------------------------------------------------------------------------------------------------

Other middlewares:

* [httpcoala](https://github.com/goware/httpcoala) - Request coalescer
* [jwtauth](https://github.com/goware/jwtauth) - JWT authenticator

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

Comparison with other routers (as of Aug 1/16): https://gist.github.com/pkieltyka/76a59d33492dd2732e691ad8c0b274a4

```shell
BenchmarkChi_Param        	 5000000	       251 ns/op	     240 B/op	       1 allocs/op
BenchmarkChi_Param5       	 5000000	       393 ns/op	     240 B/op	       1 allocs/op
BenchmarkChi_Param20      	 1000000	      1012 ns/op	     240 B/op	       1 allocs/op
BenchmarkChi_ParamWrite   	 5000000	       301 ns/op	     240 B/op	       1 allocs/op
BenchmarkChi_GithubStatic 	 5000000	       287 ns/op	     240 B/op	       1 allocs/op
BenchmarkChi_GithubParam  	 3000000	       442 ns/op	     240 B/op	       1 allocs/op
BenchmarkChi_GithubAll    	   20000	     90855 ns/op	   48723 B/op	     203 allocs/op
BenchmarkChi_GPlusStatic  	 5000000	       250 ns/op	     240 B/op	       1 allocs/op
BenchmarkChi_GPlusParam   	 5000000	       280 ns/op	     240 B/op	       1 allocs/op
BenchmarkChi_GPlus2Params 	 5000000	       337 ns/op	     240 B/op	       1 allocs/op
BenchmarkChi_GPlusAll     	  300000	      4128 ns/op	    3120 B/op	      13 allocs/op
BenchmarkChi_ParseStatic  	 5000000	       250 ns/op	     240 B/op	       1 allocs/op
BenchmarkChi_ParseParam   	 5000000	       275 ns/op	     240 B/op	       1 allocs/op
BenchmarkChi_Parse2Params 	 5000000	       305 ns/op	     240 B/op	       1 allocs/op
BenchmarkChi_ParseAll     	  200000	      7671 ns/op	    6240 B/op	      26 allocs/op
BenchmarkChi_StaticAll    	   30000	     55497 ns/op	   37682 B/op	     157 allocs/op
```

NOTE: the allocs in the benchmark above are from the calls to http.Request's
`WithContext(context.Context)` method that clones the http.Request, sets the `Context()`
on the duplicated (alloc'd) request and returns it the new request object. This is just
how setting context on a request in Go 1.7 works. 


## Credits

* Carl Jackson for https://github.com/zenazn/goji
  * Parts of Chi's thinking comes from goji, and Chi's middleware package
    sources from goji.
* Armon Dadgar for https://github.com/armon/go-radix
* Contributions: [@VojtechVitek](https://github.com/VojtechVitek)

We'll be more than happy to see [your contributions](./CONTRIBUTING.md)!


## Related works

Looking ahead beyond REST, I also recommend these newer ideas in the field coming from
[gRPC](https://github.com/grpc/grpc-go), [go-kit](https://github.com/go-kit/kit) and
[graphql](https://github.com/graphql-go/graphql). They're all pretty cool with their
own unique approaches and benefits.


## License

Copyright (c) 2015-present [Peter Kieltyka](https://github.com/pkieltyka)

Licensed under [MIT License](./LICENSE)

[GoDoc]: https://godoc.org/github.com/pressly/chi
[GoDoc Widget]: https://godoc.org/github.com/pressly/chi?status.svg
[Travis]: https://travis-ci.org/pressly/chi
[Travis Widget]: https://travis-ci.org/pressly/chi.svg?branch=master
