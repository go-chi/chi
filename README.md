chi
===

`chi` is an expressive, small and fast HTTP mux/router for Go web services built on net/context.

Chi encourages writing services by composing small handlers and middlewares with many or few routes.
Each middleware is like a layer of an onion connected through a consistent interface (http.Handler or
chi.Handler) and a context.Context argument that flows down the layers during a request's lifecycle.

In order to get the most out of this pattern, chi's routing methods (Get, Post, Handle, Mount, etc.)
support inline middlewares, middleware groups, and mounting (composing) any chi router to another -
a bushel of onions. We've designed the Pressly API (150+ routes/handlers) exactly like this and its
scaled very well.

![alt tag](https://imgry.pressly.com/x/fetch?url=deeporigins-deeporiginsllc.netdna-ssl.com/wp-content/uploads/sites/4/2015/09/Tai_Chi2.jpg&size=800x)


## Features

* Lightweight - cloc`d in 573 LOC for the chi router
* Fast - yes, benchmarks coming
* Expressive routing - middleware stacks, inline middleware, groups, mount routers
* Request context control (value chaining, deadlines and timeouts) - built on `net/context`
* Robust (tested, used in production)

## Router design

Chi's router is based on a kind of [Radix patricia trie](https://en.wikipedia.org/wiki/Radix_tree).
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

```go
// Mini-example
// ...
r := chi.NewRouter()
r.Post("/login", EnforceSSL, LoginHandler) // inline middleware on the routing definition
// ...

// A dummy middleware to ensure the request URI scheme is HTTPS
func EnforceSSL(next http.Handler) http.Handler {
  return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
    if r.URL.Scheme != "HTTPS" {
      w.WriteHeader(405)
      return
    }
    next.ServeHTTP(w, r)
  })
}

func LoginHandler(ctx context.Context, w http.ResponseWriter, r *http.Request) {
  // read POST body from the request and authenticate, and respond accordingly
  // ...
}
```

We lose type checking during compilation of the `handlers`, but that'll be resolved
sometime in the [future](http://...), we hope, when Go's stdlib supports net/context
in net/http. Instead, chi checks the types at runtime and panics in case of a mismatch.

The supported handlers are as follows..


### Middleware handlers

```go
// Standard HTTP middleware. Perfect for when a request context isn't required for signaling.
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
  userID := chi.URLParams(ctx)["userID"].(string) // from a route like /users/:userID
  key := ctx.Value("key").(string)
  w.Write([]byte(fmt.Sprintf("hi %v, %v", userID, key)))
}
```

## net/context?

`net/context` is a tiny library written by [Sameer Ajmani](https://github.com/Sajmani) that provides
a simple interface to signal context across goroutines.

Learn more at https://blog.golang.org/context

and..
* Docs: https://godoc.org/golang.org/x/net/context
* Source: https://github.com/golang/net/tree/master/context
* net/http client managed by context.Context: https://github.com/golang/net/tree/master/context/ctxhttp


## Examples

--todo--

see: _examples/simple

.. show request timeout with context.Context


## Middlewares

Chi comes equipped with an optional `middleware` package, providing:

-------------------------------------------------------------------------------------------------
| Middleware  | Description                                                                     |
| :---------- | :--------------------------------------------------------------------------------
|             |                                                                                 |
| RequestID   | Injects a request ID into the context of each request.                          |
|             |                                                                                 |
| RealIP      | Sets a http.Request's RemoteAddr to the results of parsing either the           |
|             | X-Forwarded-For header or the X-Real-IP header.                                 |
|             |                                                                                 |
| Logger      | Log the start and end of each request with the elapsed processing time.         |
|             |                                                                                 |
| Recoverer   | Gracefully absorb panics and print the stack trace.                             |
|             |                                                                                 |
| NoCache     | Set response headers to prevent clients from caching.                           |
|             |                                                                                 |
| CloseNotify | Signals to the request context when a client has closed their connection.       |
|             |                                                                                 |
| Timeout     | Signals to the request context when the timeout deadline is reached.            |
|             |                                                                                 |
| Throttle    | Put a ceiling on the number of concurrent requests.                             |
-------------------------------------------------------------------------------------------------

Other middlewares:

* [httpcoala](https://github.com/goware/httpcoala) - request coalescer
* [jwtauth](https://github.com/goware/jwtauth) - JWT authenticator

please submit a PR if you'd like to include a link to a chi middleware


## Future

We're hopefully that by Go 1.7 (in 2016), `net/context` will be in the Go stdlib and net/http will
support context.Context natively, at which point we'll be updating the signatures to embrace the
future stdlib. And... then, we have infinitely more middlewares to compose from the community!!

See discussions:
* https://github.com/golang/go/issues/13021
* https://groups.google.com/forum/#!topic/golang-dev/cQs1z9LrJDU


## Credits

* Carl Jackson for https://github.com/zenazn/goji
  * Parts of Chi's thinking comes from goji, and Chi's middleware package
    sources from goji.
* Armon Dadgar for https://github.com/armon/go-radix
* Pressly team for inspiration


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
