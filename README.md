chi [![GoDoc](https://godoc.org/github.com/pressly/chi?status.svg)](https://godoc.org/github.com/pressly/chi)
===

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

* Lightweight - cloc`d in 578 LOC for the chi router
* Fast - yes, benchmarks coming
* Expressive routing - middleware stacks, inline middleware, groups, mount routers
* Request context control (value chaining, deadlines and timeouts) - built on `net/context`
* Robust (tested, used in production)

## Router design

Chi's router is based on a kind of [Patricia Radix trie](https://en.wikipedia.org/wiki/Radix_tree).
Built on top of the tree is the `Router` interface:

```go
// Register a middleware handler (or few) on the middleware stack
Use(middlewares ...interface{})

// Register a new middleware stack
Group(fn func(r Router)) Router

// Mount an inline sub-router
Route(pattern string, fn func(r Router)) Router

// Mount a sub-router
Mount(pattern string, handlers ...interface{})

// Register routing handler for all http methods
Handle(pattern string, handlers ...interface{})

// Register routing handler for CONNECT http method
Connect(pattern string, handlers ...interface{})

// Register routing handler for HEAD http method
Head(pattern string, handlers ...interface{})

// Register routing handler for GET http method
Get(pattern string, handlers ...interface{})

// Register routing handler for POST http method
Post(pattern string, handlers ...interface{})

// Register routing handler for PUT http method
Put(pattern string, handlers ...interface{})

// Register routing handler for PATCH http method
Patch(pattern string, handlers ...interface{})

// Register routing handler for DELETE http method
Delete(pattern string, handlers ...interface{})

// Register routing handler for TRACE http method
Trace(pattern string, handlers ...interface{})

// Register routing handler for OPTIONS http method
Options(pattern string, handlers ...interface{})
```

Each routing method accepts a URL `pattern` and chain of `handlers`. The URL pattern
supports named params (ie. `/users/:userID`) and wildcards (ie. `/admin/*`).

The `handlers` argument can be a single request handler, or a chain of middleware
handlers, followed by a request handler. The request handler is required, and must
be the last argument.

We lose type checking of the handlers, but that'll be resolved sometime in the [future](#future),
we hope, when Go's stdlib supports net/context in net/http. For now, chi checks the types
at runtime and panics in case of a mismatch.

The supported handlers are as follows..


### Middleware handlers

```go
// Standard HTTP middleware. Compatible and friendly for when a request context isn't needed.
func StdMiddleware(next http.Handler) http.Handler {
  return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
    next.ServeHTTP(w, r)
  })
}
```

```go
// net/context HTTP middleware. Useful for signaling to stop processing, adding a timeout,
// cancellation, or passing data down the middleware chain.
func CtxMiddleware(next chi.Handler) chi.Handler {
  return chi.HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
    ctx = context.WithValue(ctx, "key", "value")
    next.ServeHTTPC(ctx, w, r)
  })
}
```

### Request handlers

```go
// Standard HTTP handler
func StdHandler(w http.ResponseWriter, r *http.Request) {
  w.Write([]byte("hi"))
}
```

```go
// net/context HTTP request handler
func CtxHandler(ctx context.Context, w http.ResponseWriter, r *http.Request) {
  userID := chi.URLParams(ctx)["userID"] // from a route like /users/:userID
  key := ctx.Value("key").(string)
  w.Write([]byte(fmt.Sprintf("hi %v, %v", userID, key)))
}
```

## net/context?

`net/context` is a tiny library written by [Sameer Ajmani](https://github.com/Sajmani) that provides
a simple interface to signal context across call stacks and goroutines.

Learn more at https://blog.golang.org/context

and..
* Docs: https://godoc.org/golang.org/x/net/context
* Source: https://github.com/golang/net/tree/master/context
* net/http client managed by context.Context: https://github.com/golang/net/tree/master/context/ctxhttp


## Examples

Examples: [simple](https://github.com/pressly/chi/blob/master/_examples/simple/main.go) &
[rest](https://github.com/pressly/chi/blob/master/_examples/rest/main.go)

Preview:

```go
import (
  //...
  "github.com/pressly/chi"
  "github.com/pressly/chi/middleware"
  "golang.org/x/net/context"
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

  // REST routes for "articles" resource
  r.Route("/articles", func(r chi.Router) {
    r.Get("/", paginate, listArticles)  // GET /articles
    r.Post("/", createArticle)          // POST /articles

    r.Route("/:articleID", func(r chi.Router) {
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

func ArticleCtx(next chi.Handler) chi.Handler {
  return chi.HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
    articleID := chi.URLParams(ctx)["articleID"]
    article, err := dbGetArticle(articleID)
    if err != nil {
      http.Error(w, http.StatusText(404), 404)
      return
    }
    ctx = context.WithValue(ctx, "article", article)
    next.ServeHTTPC(ctx, w, r)
  })
}

func getArticle(ctx context.Context, w http.ResponseWriter, r *http.Request) {
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

func AdminOnly(next chi.Handler) chi.Handler {
  return chi.HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
    perm, ok := ctx.Value("acl.permission").(YourPermissionType)
    if !ok || !perm.IsAdmin() {
      http.Error(w, http.StatusText(403), 403)
      return
    }
    next.ServeHTTPC(ctx, w, r)
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

please submit a PR if you'd like to include a link to a chi middleware


## Future

We're hoping that by Go 1.7 (in 2016), `net/context` will be in the Go stdlib and `net/http` will
support `context.Context`. You'll notice that chi.Handler and http.Handler are very similar
and the middleware signatures follow the same structure. One day chi.Handler will be deprecated
and the router will live on just as it is without any dependencies beyond stdlib. And... then, we
have infinitely more middlewares to compose from the community!!

See discussions:
* https://github.com/golang/go/issues/13021
* https://groups.google.com/forum/#!topic/golang-dev/cQs1z9LrJDU


## Credits

* Carl Jackson for https://github.com/zenazn/goji
  * Parts of Chi's thinking comes from goji, and Chi's middleware package
    sources from goji.
* Armon Dadgar for https://github.com/armon/go-radix
* Contributions: [@VojtechVitek](https://github.com/VojtechVitek)


## TODO

* Mux options
  * Trailing slash?
  * Case insensitive paths?
  * GET for HEAD requests (auto fallback)?
* Register not found handler
* Register error handler (500's)
* HTTP2 example
  * both http 1.1 and http2 automatically.. just turn it on :)
* Websocket example
* Regexp support in router "/:id([0-9]+)" or "#id^[0-9]+$" or ..


## License

Copyright (c) 2015 Peter Kieltyka (https://twitter.com/peterk)

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
