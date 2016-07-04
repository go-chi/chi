chi
===

[![GoDoc Widget]][GoDoc] [![Travis Widget]][Travis]

`chi` is a small, fast and expressive router / mux for Go HTTP services built with net/context.

Chi encourages writing services by composing small handlers and middlewares with many or few routes.
Each middleware is like a layer of an onion connected through a consistent interface (http.Handler or
chi.Handler) and a context.Context argument that flows down the layers during a request's lifecycle.

In order to get the most out of this pattern, chi's routing methods (Get, Post, Handle, Mount, etc.)
support inline middlewares, middleware groups, and mounting (composing) any chi router to another -
a bushel of onions. We've designed the Pressly API (150+ routes/handlers) exactly like this and its
scaled very well.

![alt tag](https://imgry.pressly.com/x/fetch?url=deeporigins-deeporiginsllc.netdna-ssl.com/wp-content/uploads/sites/4/2015/09/Tai_Chi2.jpg&size=800x)


## Features

* **Lightweight** - cloc'd in <1000 LOC for the chi router
* **Fast** - yes, see [benchmarks](#benchmarks)
* **Zero allocations** - no GC pressure during routing
* **Designed for modular/composable APIs** - middlewares, inline middlewares, route groups and subrouter mounting
* **Context control** - built on new `context` package, providing value chaining, deadlines and timeouts
* **Robust** - tested / used in production
* **No external dependencies** - plain ol' Go 1.7+ stdlib

## Router design

Chi's router is based on a kind of [Patricia Radix trie](https://en.wikipedia.org/wiki/Radix_tree).
Built on top of the tree is the `Router` interface:

```go
// Register a middleware handler (or few) on the middleware stack
Use(middlewares ...func(http.Handler) http.Handler

// Mount a sub-router along a pattern
Route(pattern string, fn func(r Router)) Router

// Register a new inline-Mux, which offers a fresh middleware stack
Group(fn func(r Router)) Router

// Mount a sub-router
Mount(pattern string, subrouter Router)

// Register routing handler for all http methods
Handle(pattern string, handler http.Handler)

// Register routing handler func for all http methods
HandleFunc(pattern string, handler http.HandlerFunc)

// Register routing handler for CONNECT http method
Connect(pattern string, handler http.HandlerFunc)

// Register routing handler for HEAD http method
Head(pattern string, handler http.HandlerFunc)

// Register routing handler for GET http method
Get(pattern string, handler http.HandlerFunc)

// Register routing handler for POST http method
Post(pattern string, handler http.HandlerFunc)

// Register routing handler for PUT http method
Put(pattern string, handler http.HandlerFunc)

// Register routing handler for PATCH http method
Patch(pattern string, handler http.HandlerFunc)

// Register routing handler for DELETE http method
Delete(pattern string, handler http.HandlerFunc)

// Register routing handler for TRACE http method
Trace(pattern string, handler http.HandlerFunc)

// Register routing handler for OPTIONS http method
Options(pattern string, handler http.HandlerFunc)
```

Each routing method accepts a URL `pattern` and chain of `handlers`. The URL pattern
supports named params (ie. `/users/:userID`) and wildcards (ie. `/admin/*`).

The supported handlers are as follows..


### Middleware handlers

```go
// HTTP middleware.
func Middleware(next http.Handler) http.Handler {
  return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
    next.ServeHTTP(w, r)
  })
}
```

### Request handlers

```go
// HTTP handler.
func Handler(w http.ResponseWriter, r *http.Request) {
  w.Write([]byte("hi"))
}
```

```go
// HTTP handler with use of request context.
func CtxHandler(w http.ResponseWriter, r *http.Request) {
  userID := chi.URLParam(r, "userID") // from a route like /users/:userID

  ctx := r.Context()
  key := ctx.Value("key").(string)

  w.Write([]byte(fmt.Sprintf("hi %v, %v", userID, key)))
}
```

## context?

`context` is a tiny pkg that provides simple interface to signal context across call stacks
and goroutines. It was originally written by [Sameer Ajmani](https://github.com/Sajmani)
and is available in stdlib since go1.7.

Learn more at https://blog.golang.org/context

and..
* Docs: https://tip.golang.org/pkg/context
* Source: https://github.com/golang/go/tree/master/src/context

## Examples

Examples:
* [simple](https://github.com/pressly/chi/blob/master/_examples/simple/main.go) - The power of handler composability
* [rest](https://github.com/pressly/chi/blob/master/_examples/rest/main.go) - REST apis made easy; includes a simple JSON responder

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
  r.Group("/articles", func(r chi.Router) {
    r.Get("/", paginate, listArticles)  // GET /articles
    r.Post("/", createArticle)          // POST /articles

    r.Group("/:articleID", func(r chi.Router) {
      r.Use(ArticleCtx)
      r.Get("/", getArticle)            // GET /articles/123
      r.Put("/", updateArticle)         // PUT /articles/123
      r.Delete("/", deleteArticle)      // DELETE /articles/123
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
func adminRouter() chi.Router {
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


## Middlewares

Chi comes equipped with an optional `middleware` package, providing:

-------------------------------------------------------------------------------------------------
| Middleware  | Description                                                                     |
|:------------|:---------------------------------------------------------------------------------
| RequestID   | Injects a request ID into the context of each request.                          |
| RealIP      | Sets a http.Request's RemoteAddr to either X-Forwarded-For or X-Real-IP.        |
| Logger      | Logs the start and end of each request with the elapsed processing time.        |
| Recoverer   | Gracefully absorb panics and prints the stack trace.                            |
| NoCache     | Sets response headers to prevent clients from caching.                          |
| CloseNotify | Signals to the request context when a client has closed their connection.       |
| Timeout     | Signals to the request context when the timeout deadline is reached.            |
| Throttle    | Puts a ceiling on the number of concurrent requests.                            |
-------------------------------------------------------------------------------------------------

Other middlewares:

* [httpcoala](https://github.com/goware/httpcoala) - request coalescer
* [jwtauth](https://github.com/goware/jwtauth) - JWT authenticator

please [submit a PR](./CONTRIBUTING.md) if you'd like to include a link to a chi middleware


## Future

We're hoping that by Go 1.7 (in 2016), `net/context` will be in the Go stdlib and `net/http` will
support `context.Context`. You'll notice that chi.Handler and http.Handler are very similar
and the middleware signatures follow the same structure. One day chi.Handler will be deprecated
and the router will live on just as it is without any dependencies beyond stdlib. And... then, we
have infinitely more middlewares to compose from the community!!

See discussions:
* https://github.com/golang/go/issues/13021
* https://groups.google.com/forum/#!topic/golang-dev/cQs1z9LrJDU


## Benchmarks

The benchmark suite: https://github.com/pkieltyka/go-http-routing-benchmark

```shell
BenchmarkChi_Param            10000000         128 ns/op         0 B/op        0 allocs/op
BenchmarkChi_Param5            5000000         303 ns/op         0 B/op        0 allocs/op
BenchmarkChi_Param20           1000000        1064 ns/op         0 B/op        0 allocs/op
BenchmarkChi_ParamWrite       10000000         181 ns/op         0 B/op        0 allocs/op
BenchmarkChi_GithubStatic     10000000         193 ns/op         0 B/op        0 allocs/op
BenchmarkChi_GithubParam       5000000         344 ns/op         0 B/op        0 allocs/op
BenchmarkChi_GithubAll           20000       63100 ns/op         0 B/op        0 allocs/op
BenchmarkChi_GPlusStatic      20000000         124 ns/op         0 B/op        0 allocs/op
BenchmarkChi_GPlusParam       10000000         172 ns/op         0 B/op        0 allocs/op
BenchmarkChi_GPlus2Params      5000000         232 ns/op         0 B/op        0 allocs/op
BenchmarkChi_GPlusAll           500000        2684 ns/op         0 B/op        0 allocs/op
BenchmarkChi_ParseStatic      10000000         135 ns/op         0 B/op        0 allocs/op
BenchmarkChi_ParseParam       10000000         154 ns/op         0 B/op        0 allocs/op
BenchmarkChi_Parse2Params     10000000         192 ns/op         0 B/op        0 allocs/op
BenchmarkChi_ParseAll           300000        4637 ns/op         0 B/op        0 allocs/op
BenchmarkChi_StaticAll           50000       37583 ns/op         0 B/op        0 allocs/op
```

## Credits

* Carl Jackson for https://github.com/zenazn/goji
  * Parts of Chi's thinking comes from goji, and Chi's middleware package
    sources from goji.
* Armon Dadgar for https://github.com/armon/go-radix
* Contributions: [@VojtechVitek](https://github.com/VojtechVitek)

We'll be more than happy to see [your contributions](./CONTRIBUTING.md)!

## License

Copyright (c) 2015-present [Peter Kieltyka](https://github.com/pkieltyka)

Licensed under [MIT License](./LICENSE)

[GoDoc]: https://godoc.org/github.com/pressly/chi
[GoDoc Widget]: https://godoc.org/github.com/pressly/chi?status.svg
[Travis]: https://travis-ci.org/pressly/chi
[Travis Widget]: https://travis-ci.org/pressly/chi.svg?branch=master
