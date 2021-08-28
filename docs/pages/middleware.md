# 🧬 Middleware

## Introduction

> Middleware performs some specific function on the HTTP request or response at a specific stage in the HTTP pipeline before or after the user defined controller. Middleware is a design pattern to eloquently add cross cutting concerns like logging, handling authentication without having many code contact points.


`chi's` middlewares are just stdlib net/http middleware handlers. There is nothing special about them, which means the router and all the tooling is designed to be compatible and friendly with any middleware in the community. This offers much better extensibility and reuse of packages and is at the heart of chi's purpose.

Here is an example of a standard net/http middleware where we assign a context key `"user"` the value of `"123"`. This middleware sets a hypothetical user identifier on the request context and calls the next handler in the chain.

```go
// HTTP middleware setting a value on the request context
func MyMiddleware(next http.Handler) http.Handler {
  return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
    // create new context from `r` request context, and assign key `"user"`
    // to value of `"123"`
    ctx := context.WithValue(r.Context(), "user", "123")

    // call the next handler in the chain, passing the response writer and
    // the updated request object with the new context value.
    //
    // note: context.Context values are nested, so any previously set
    // values will be accessible as well, and the new `"user"` key
    // will be accessible from this point forward.
    next.ServeHTTP(w, r.WithContext(ctx))
  })
}
```

We can now take these values from the context in our Handlers like this:
```go
func MyHandler(w http.ResponseWriter, r *http.Request) {
    // here we read from the request context and fetch out `"user"` key set in
    // the MyMiddleware example above.
    user := r.Context().Value("user").(string)

    // respond to the client
    w.Write([]byte(fmt.Sprintf("hi %s", user)))
}
```



## AllowContentEncoding

AllowContentEncoding enforces a whitelist of request Content-Encoding otherwise responds with a `415 Unsupported Media Type status`.

Content-Encoding Parameters: `gzip`, `deflate`, `gzip, deflate`, `deflate, gzip`

***This Middleware Doesn't Support `br` encoding***

Refer [Content-Encoding](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Encoding)

#### Usage

```go
import (
  "github.com/go-chi/chi/v5/middleware"
)

func main() {
  r := chi.NewRouter()
  r.Use(middleware.AllowContentEncoding("deflate", "gzip"))
  r.Post("/", func(w http.ResponseWriter, r *http.Request) {})
}
```


## AllowContentType

AllowContentType enforces a whitelist of request Content-Types otherwise responds with a `415 Unsupported Media Type status`.

Content-Type Parameters: `application/json`, `text/xml`, `application/json, text/xml`

Refer [Content-Type](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Type)

Usage

```go
import (
  "github.com/go-chi/chi/v5/middleware"
)

func main(){
  r := chi.NewRouter()
  r.Use(middleware.AllowContentEncoding("application/json","text/xml"))
  r.Post("/", func(w http.ResponseWriter, r *http.Request) {})
}
```

## CleanPath

CleanPath middleware will clean out double slash mistakes from a user's request path.
For example, if a user requests /users//1 or //users////1 will both be treated as: /users/1

Usage

```go
import (
  "github.com/go-chi/chi/v5/middleware"
)

func main(){
  r := chi.NewRouter()
  r.Use(middleware.CleanPath)
  r.Post("/", func(w http.ResponseWriter, r *http.Request) {})
}
```

## Compress

Compress is a middleware that compresses response body of a given content types to a data format based on Accept-Encoding request header. It uses a given compression level.

**NOTE:** *make sure to set the Content-Type header on your response otherwise this middleware will not compress the response body. For ex, in your handler you should set w.Header().Set("Content-Type", http.DetectContentType(yourBody)) or set it manually.*

Usage

```go
import (
  "github.com/go-chi/chi/v5/middleware"
)

func main(){
  r := chi.NewRouter()
  r.Use(middleware.Compress(5, "text/html", "text/css"))
  r.Post("/", func(w http.ResponseWriter, r *http.Request) {})
}
```
## ContentCharset

ContentCharset generates a handler that writes a 415 Unsupported Media Type response if none of the charsets match.
An empty charset will allow requests with no Content-Type header or no specified charset.

Usage

```go
import (
  "github.com/go-chi/chi/v5/middleware"
)

func main(){
  r := chi.NewRouter()
  allowedCharsets := []string{"UTF-8", "Latin-1", ""}
  r.Use(middleware.ContentCharset(allowedCharsets...))
  r.Post("/", func(w http.ResponseWriter, r *http.Request) {})
}
```

## CORS
To Implement CORS in `chi` we can use [go-chi/cors](https://github.com/go-chi/cors)

This middleware is designed to be used as a top-level middleware on the chi router. Applying with within a `r.Group()` or using `With()` **will not work without routes matching OPTIONS added**.

#### Usage

```go
func main() {
  r := chi.NewRouter()

  // Basic CORS
  // for more ideas, see: https://developer.github.com/v3/#cross-origin-resource-sharing
  r.Use(cors.Handler(cors.Options{
    // AllowedOrigins:   []string{"https://foo.com"}, // Use this to allow specific origin hosts
    AllowedOrigins:   []string{"https://*", "http://*"},
    // AllowOriginFunc:  func(r *http.Request, origin string) bool { return true },
    AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
    AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token"},
    ExposedHeaders:   []string{"Link"},
    AllowCredentials: false,
    MaxAge:           300, // Maximum value not ignored by any of major browsers
  }))

  r.Get("/", func(w http.ResponseWriter, r *http.Request) {
    w.Write([]byte("welcome"))
  })

  http.ListenAndServe(":3000", r)
}
```

## GetHead
GetHead automatically route undefined HEAD requests to GET handlers.

Reference: [HEAD](https://developer.mozilla.org/en-US/docs/Web/HTTP/Methods/HEAD)

Usage

```go
import (
  "github.com/go-chi/chi/v5/middleware"
)

func main(){
  r := chi.NewRouter()
  r.Use(middleware.GetHead)
  r.Get("/", func(w http.ResponseWriter, r *http.Request) {})
}
```


<!-- ## GetReqID -->
<!-- Add Request ID Docs -->
## Heartbeat

Heartbeat endpoint middleware useful to setting up a path like `/ping` that load balancers or uptime testing external services can make a request before hitting any routes. It's also convenient to place this above ACL middlewares as well.

Usage
```go
import (
  "github.com/go-chi/chi/v5/middleware"
)

func main(){
  r := chi.NewRouter()
  r.Use(middleware.Heartbeat("/"))
}
```
```
Get -> http://api_address/ 

Response -> ".", Status 200
```

## Logger

Logger is a middleware that logs the start and end of each request, along
with some useful data about what was requested, what the response status was,
and how long it took to return. When standard output is a TTY, Logger will
print in color, otherwise it will print in black and white. Logger prints a
request ID if one is provided.

Alternatively, look at https://github.com/goware/httplog for a more in-depth
http logger with structured logging support.

**IMPORTANT NOTE**: *Logger should go before any other middleware that may change
the response, such as `middleware.Recoverer`*.

Usage

```go
import (
  "github.com/go-chi/chi/v5/middleware"
)

func main(){
  r := chi.NewRouter()
  r.Use(middleware.Logger)        // <--<< Logger should come before Recoverer
  r.Use(middleware.Recoverer)
  r.Get("/", handler)
}
```

## NoCache

NoCache is a simple piece of middleware that sets a number of HTTP headers to prevent
a router (or subrouter) from being cached by an upstream proxy and/or client.

As per http://wiki.nginx.org/HttpProxyModule - NoCache sets:
```
Expires: Thu, 01 Jan 1970 00:00:00 UTC
Cache-Control: no-cache, private, max-age=0
X-Accel-Expires: 0
Pragma: no-cache (for HTTP/1.0 proxies/clients)
```
Usage

```go
import (
  "github.com/go-chi/chi/v5/middleware"
)

func main(){
  r := chi.NewRouter()
  r.Use(middleware.NoCache)
  r.Post("/", func(w http.ResponseWriter, r *http.Request) {})
}
```

## Profiler

Profiler is a convenient subrouter used for mounting net/http/pprof. ie.
Usage

```go
import (
  "github.com/go-chi/chi/v5/middleware"
)

 func main(){
   r := chi.NewRouter()
   // ..middlewares
   r.Mount("/debug", middleware.Profiler())
   // ..routes
}
```
Now you can request @ /debug for pprof profiles

## RealIP

RealIP is a middleware that sets a http.Request's RemoteAddr to the results
of parsing either the X-Real-IP header or the X-Forwarded-For header (in that
order).

This middleware should be inserted fairly early in the middleware stack to
ensure that subsequent layers (e.g., request loggers) which examine the
RemoteAddr will see the intended value.

You should only use this middleware if you can trust the headers passed to
you (in particular, the two headers this middleware uses), for example
because you have placed a reverse proxy like HAProxy or nginx in front of
chi. If your reverse proxies are configured to pass along arbitrary header
values from the client, or if you use this middleware without a reverse
proxy, malicious clients will be able to cause harm (or, depending on
how you're using RemoteAddr, vulnerable to an attack of some sort).

Usage


```go
import (
  "github.com/go-chi/chi/v5/middleware"
)

 func main(){
   r := chi.NewRouter()
   // ..middlewares
   r.Use(middleware.RealIP)
   // ..routes
}
```

## Recoverer

Recoverer is a middleware that recovers from panics, logs the panic (and a
backtrace), and returns a HTTP 500 (Internal Server Error) status if
possible. Recoverer prints a request ID if one is provided.

Usage

```go
import (
  "github.com/go-chi/chi/v5/middleware"
)

 func main(){
   r := chi.NewRouter()
   // ..middlewares
   r.Use(middleware.Recoverer)
   // ..routes
   r.Get("/", func(http.ResponseWriter, *http.Request) { panic("foo") })
}
```

## RedirectSlashes

RedirectSlashes is a middleware that will match request paths with a trailing
slash and redirect to the same path, less the trailing slash.

NOTE: RedirectSlashes middleware is *incompatible* with http.FileServer,
see [Issue 343](https://github.com/go-chi/chi/issues/343)

Usage

```go
import (
  "github.com/go-chi/chi/v5/middleware"
)

func main(){
   r := chi.NewRouter()
   r.Use(middleware.RedirectSlashes)
   r.Post("/", func(w http.ResponseWriter, r *http.Request) {})
}
```

## RouteHeaders

RouteHeaders is a neat little header-based router that allows you to direct
the flow of a request through a middleware stack based on a request header.

For example, lets say you'd like to setup multiple routers depending on the
request Host header, you could then do something as so:

```go
r := chi.NewRouter()
rSubdomain := chi.NewRouter()

r.Use(middleware.RouteHeaders().
  Route("Host", "example.com", middleware.New(r)).
  Route("Host", "*.example.com", middleware.New(rSubdomain)).
  Handler)

r.Get("/", h)
rSubdomain.Get("/", h2)

```
Another example, imagine you want to setup multiple CORS handlers, where for
your origin servers you allow authorized requests, but for third-party public
requests, authorization is disabled.

```go
r := chi.NewRouter()

r.Use(middleware.RouteHeaders().
  Route("Origin", "https://app.skyweaver.net", cors.Handler(cors.Options{
	   AllowedOrigins:   []string{"https://api.skyweaver.net"},
	   AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
	   AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type"},
	   AllowCredentials: true, // <----------<<< allow credentials
  })).
  Route("Origin", "*", cors.Handler(cors.Options{
	   AllowedOrigins:   []string{"*"},
	   AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
	   AllowedHeaders:   []string{"Accept", "Content-Type"},
	   AllowCredentials: false, // <----------<<< do not allow credentials
  })).
  Handler)
```

## StripSlashes

StripSlashes is a middleware that will match request paths with a trailing
slash, strip it from the path and continue routing through the mux, if a route
matches, then it will serve the handler.

Usage

```go
import (
  "github.com/go-chi/chi/v5/middleware"
)

func main(){
   r := chi.NewRouter()
   r.Use(middleware.StripSlashes)
   r.Post("/", func(w http.ResponseWriter, r *http.Request) {})
}
```

## Throttle

Throttle is a middleware that limits number of currently processed requests
at a time across all users. Note: Throttle is not a rate-limiter per user,
instead it just puts a ceiling on the number of currentl in-flight requests
being processed from the point from where the Throttle middleware is mounted.

Throttle has a BacklogTimeout of 60 seconds by default

Usage
```go
import (
  "github.com/go-chi/chi/v5/middleware"
)

func main(){
    r := chi.NewRouter()
    r.Use(middleware.Throttle(15))
    r.Post("/", func(w http.ResponseWriter, r *http.Request) {})
}
```

## ThrottleBacklog
ThrottleBacklog is a middleware that limits number of currently processed
requests at a time and provides a backlog for holding a finite number of
pending requests.

Usage

```go
import (
  "time"

  "github.com/go-chi/chi/v5/middleware"
)

func main(){
    r := chi.NewRouter()
    r.Use(ThrottleBacklog(10, 50, time.Second*10))
    r.Post("/", func(w http.ResponseWriter, r *http.Request) {})
}
```

## Timeout
Timeout is a middleware that cancels ctx after a given timeout and return
a 504 Gateway Timeout error to the client.

It's required that you select the ctx.Done() channel to check for the signal
if the context has reached its deadline and return, otherwise the timeout
signal will be just ignored.

ie. a route/handler may look like:
```go
 r.Get("/long", func(w http.ResponseWriter, r *http.Request) {
	 ctx := r.Context()
	 processTime := time.Duration(rand.Intn(4)+1) * time.Second

	 select {
	 case <-ctx.Done():
	 	return

	 case <-time.After(processTime):
	 	 // The above channel simulates some hard work.
	 }

	 w.Write([]byte("done"))
 })
```

Usage

```go
import (
  "github.com/go-chi/chi/v5/middleware"
)

func main(){
    r := chi.NewRouter()
    r.Use(middleware.Timeout(time.Second*60))
    // handlers ...
}
```

<!-- ## URLFormat
## WithLogEntry
## WithValue -->

## JWT Authentication

For Implementing JWT Authentication we can use `go-chi/jwtauth`
It is a middleware built upon lestrrat-go/jwx


The `jwtauth` http middleware package provides a simple way to verify a JWT token
from a http request and send the result down the request context (`context.Context`).

In a complete JWT-authentication flow, you'll first capture the token from a http
request, decode it, verify it and then validate that its correctly signed and hasn't
expired - the `jwtauth.Verifier` middleware handler takes care of all of that. The
`jwtauth.Verifier` will set the context values on keys `jwtauth.TokenCtxKey` and
`jwtauth.ErrorCtxKey`.

Next, it's up to an authentication handler to respond or continue processing after the
`jwtauth.Verifier`. The `jwtauth.Authenticator` middleware responds with a 401 Unauthorized
plain-text payload for all unverified tokens and passes the good ones through. You can
also copy the Authenticator and customize it to handle invalid tokens to better fit
your flow (ie. with a JSON error response body).

By default, the `Verifier` will search for a JWT token in a http request, in the order:

1.  'Authorization: BEARER T' request header
2.  'jwt' Cookie value

The first JWT string that is found as an authorization header
or cookie header is then decoded by the `lestrrat-go/jwx` library and a jwt.Token
object is set on the request context. In the case of a signature decoding error
the Verifier will also set the error on the request context.

The Verifier always calls the next http handler in sequence, which can either
be the generic `jwtauth.Authenticator` middleware or your own custom handler
which checks the request context jwt token and error to prepare a custom
http response.

Note: jwtauth supports custom verification sequences for finding a token
from a request by using the `Verify` middleware instantiator directly. The default
`Verifier` is instantiated by calling `Verify(ja, TokenFromHeader, TokenFromCookie)`.

Usage

See the full [example](https://github.com/go-chi/jwtauth/blob/master/_example/main.go).


```go
package main

import (
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/jwtauth/v5"
)

var tokenAuth *jwtauth.JWTAuth

func init() {
	tokenAuth = jwtauth.New("HS256", []byte("secret"), nil) // replace with secret key

	// For debugging/example purposes, we generate and print
	// a sample jwt token with claims `user_id:123` here:
	_, tokenString, _ := tokenAuth.Encode(map[string]interface{}{"user_id": 123})
	fmt.Printf("DEBUG: a sample jwt is %s\n\n", tokenString)
}

func main() {
	addr := ":3333"
	fmt.Printf("Starting server on %v\n", addr)
	http.ListenAndServe(addr, router())
}

func router() http.Handler {
	r := chi.NewRouter()

	// Protected routes
	r.Group(func(r chi.Router) {
		// Seek, verify and validate JWT tokens
		r.Use(jwtauth.Verifier(tokenAuth))

		// Handle valid / invalid tokens. In this example, we use
		// the provided authenticator middleware, but you can write your
		// own very easily, look at the Authenticator method in jwtauth.go
		// and tweak it, its not scary.
		r.Use(jwtauth.Authenticator)

		r.Get("/admin", func(w http.ResponseWriter, r *http.Request) {
			_, claims, _ := jwtauth.FromContext(r.Context())
			w.Write([]byte(fmt.Sprintf("protected area. hi %v", claims["user_id"])))
		})
	})

	// Public routes
	r.Group(func(r chi.Router) {
		r.Get("/", func(w http.ResponseWriter, r *http.Request) {
			w.Write([]byte("welcome anonymous"))
		})
	})

	return r
}
```

## Http Rate Limiting Middleware

To implement this we can use [go-chi/httprate](https://github.com/go-chi/httprate)

#### Usage
```go
package main

import (
  "net/http"

  "github.com/go-chi/chi"
  "github.com/go-chi/chi/middleware"
  "github.com/go-chi/httprate"
)

func main() {
  r := chi.NewRouter()
  r.Use(middleware.Logger)

  // Enable httprate request limiter of 100 requests per minute.
  //
  // In the code example below, rate-limiting is bound to the request IP address
  // via the LimitByIP middleware handler.
  //
  // To have a single rate-limiter for all requests, use httprate.LimitAll(..).
  //
  // Please see _example/main.go for other more, or read the library code.
  r.Use(httprate.LimitByIP(100, 1*time.Minute))

  r.Get("/", func(w http.ResponseWriter, r *http.Request) {
    w.Write([]byte("."))
  })

  http.ListenAndServe(":3333", r)
}

```