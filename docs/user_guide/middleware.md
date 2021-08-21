# 🧬 Middleware

> Middleware performs some specific function on the HTTP request or response at a specific stage in the HTTP pipeline before or after the user defined controller. Middleware is a design pattern to eloquently add cross cutting concerns like logging, handling authentication without having many code contact points.


`chi's` middlewares are just stdlib net/http middleware handlers. There is nothing special about them, which means the router and all the tooling is designed to be compatible and friendly with any middleware in the community. This offers much better extensibility and reuse of packages and is at the heart of chi's purpose.

## Basic Middleware Example
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


## Usefull Pre-Made Middlewares

We have some usefull middlewares in the package `github.com/go-chi/chi/middleware`.

### Core middlewares
----------------------------------------------------------------------------------------------------
| chi/middleware Handler | description                                                             |
| :--------------------- | :---------------------------------------------------------------------- |
| [AllowContentEncoding] | Enforces a whitelist of request Content-Encoding headers                |
| [AllowContentType]     | Explicit whitelist of accepted request Content-Types                    |
| [BasicAuth]            | Basic HTTP authentication                                               |
| [Compress]             | Gzip compression for clients that accept compressed responses           |
| [ContentCharset]       | Ensure charset for Content-Type request headers                         |
| [CleanPath]            | Clean double slashes from request path                                  |
| [GetHead]              | Automatically route undefined HEAD requests to GET handlers             |
| [Heartbeat]            | Monitoring endpoint to check the servers pulse                          |
| [Logger]               | Logs the start and end of each request with the elapsed processing time |
| [NoCache]              | Sets response headers to prevent clients from caching                   |
| [Profiler]             | Easily attach net/http/pprof to your routers                            |
| [RealIP]               | Sets a http.Request's RemoteAddr to either X-Real-IP or X-Forwarded-For |
| [Recoverer]            | Gracefully absorb panics and prints the stack trace                     |
| [RequestID]            | Injects a request ID into the context of each request                   |
| [RedirectSlashes]      | Redirect slashes on routing paths                                       |
| [RouteHeaders]         | Route handling for request headers                                      |
| [SetHeader]            | Short-hand middleware to set a response header key/value                |
| [StripSlashes]         | Strip slashes on routing paths                                          |
| [Throttle]             | Puts a ceiling on the number of concurrent requests                     |
| [Timeout]              | Signals to the request context when the timeout deadline is reached     |
| [URLFormat]            | Parse extension from url and put it on request context                  |
| [WithValue]            | Short-hand middleware to set a key/value on the request context         |
----------------------------------------------------------------------------------------------------


[AllowContentEncoding]: https://pkg.go.dev/github.com/go-chi/chi/middleware#AllowContentEncoding
[AllowContentType]: https://pkg.go.dev/github.com/go-chi/chi/middleware#AllowContentType
[BasicAuth]: https://pkg.go.dev/github.com/go-chi/chi/middleware#BasicAuth
[Compress]: https://pkg.go.dev/github.com/go-chi/chi/middleware#Compress
[ContentCharset]: https://pkg.go.dev/github.com/go-chi/chi/middleware#ContentCharset
[CleanPath]: https://pkg.go.dev/github.com/go-chi/chi/middleware#CleanPath
[GetHead]: https://pkg.go.dev/github.com/go-chi/chi/middleware#GetHead
[GetReqID]: https://pkg.go.dev/github.com/go-chi/chi/middleware#GetReqID
[Heartbeat]: https://pkg.go.dev/github.com/go-chi/chi/middleware#Heartbeat
[Logger]: https://pkg.go.dev/github.com/go-chi/chi/middleware#Logger
[NoCache]: https://pkg.go.dev/github.com/go-chi/chi/middleware#NoCache
[Profiler]: https://pkg.go.dev/github.com/go-chi/chi/middleware#Profiler
[RealIP]: https://pkg.go.dev/github.com/go-chi/chi/middleware#RealIP
[Recoverer]: https://pkg.go.dev/github.com/go-chi/chi/middleware#Recoverer
[RedirectSlashes]: https://pkg.go.dev/github.com/go-chi/chi/middleware#RedirectSlashes
[RequestLogger]: https://pkg.go.dev/github.com/go-chi/chi/middleware#RequestLogger
[RequestID]: https://pkg.go.dev/github.com/go-chi/chi/middleware#RequestID
[RouteHeaders]: https://pkg.go.dev/github.com/go-chi/chi/middleware#RouteHeaders
[SetHeader]: https://pkg.go.dev/github.com/go-chi/chi/middleware#SetHeader
[StripSlashes]: https://pkg.go.dev/github.com/go-chi/chi/middleware#StripSlashes
[Throttle]: https://pkg.go.dev/github.com/go-chi/chi/middleware#Throttle
[ThrottleBacklog]: https://pkg.go.dev/github.com/go-chi/chi/middleware#ThrottleBacklog
[ThrottleWithOpts]: https://pkg.go.dev/github.com/go-chi/chi/middleware#ThrottleWithOpts
[Timeout]: https://pkg.go.dev/github.com/go-chi/chi/middleware#Timeout
[URLFormat]: https://pkg.go.dev/github.com/go-chi/chi/middleware#URLFormat
[WithLogEntry]: https://pkg.go.dev/github.com/go-chi/chi/middleware#WithLogEntry
[WithValue]: https://pkg.go.dev/github.com/go-chi/chi/middleware#WithValue
[Compressor]: https://pkg.go.dev/github.com/go-chi/chi/middleware#Compressor
[DefaultLogFormatter]: https://pkg.go.dev/github.com/go-chi/chi/middleware#DefaultLogFormatter
[EncoderFunc]: https://pkg.go.dev/github.com/go-chi/chi/middleware#EncoderFunc
[HeaderRoute]: https://pkg.go.dev/github.com/go-chi/chi/middleware#HeaderRoute
[HeaderRouter]: https://pkg.go.dev/github.com/go-chi/chi/middleware#HeaderRouter
[LogEntry]: https://pkg.go.dev/github.com/go-chi/chi/middleware#LogEntry
[LogFormatter]: https://pkg.go.dev/github.com/go-chi/chi/middleware#LogFormatter
[LoggerInterface]: https://pkg.go.dev/github.com/go-chi/chi/middleware#LoggerInterface
[ThrottleOpts]: https://pkg.go.dev/github.com/go-chi/chi/middleware#ThrottleOpts
[WrapResponseWriter]: https://pkg.go.dev/github.com/go-chi/chi/middleware#WrapResponseWriter


## Usefull Middleware Examples

<br>
<br>
<details><summary>CORS Middleware</summary>

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

#### Credits

All credit for the original work of this middleware goes out to [github.com/rs](github.com/rs).

</details>
<br>
<br>

<details><summary>JWT Authentication Middleware</summary>

To Implement JWT in `chi`, We can use [golang-jwt/jwt](https://github.com/golang-jwt/jwt)

#### Usage
```go
// JSON returns a well formated response with a status code
func JSON(w http.ResponseWriter, statusCode int, data interface{}) {
	w.WriteHeader(statusCode)
	err := json.NewEncoder(w).Encode(data)
	if err != nil {
		w.WriteHeader(500)
		er := json.NewEncoder(w).Encode(map[string]interface{}{"error": "something unexpected occurred."})
		if er != nil {
			return
		}
	}
}

// Wrapping the Middleware in a function to access the secret key
func AuthJwtWrap(SecretKey string) func(next http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var resp = map[string]interface{}{"error": "unauthorized", "message": "missing authorization token"}
			var header = r.Header.Get("Authorization")
			header = strings.TrimSpace(header)
			if header == "" {
				JSON(w, http.StatusUnauthorized, resp)
				return
			}

			token, err := jwt.Parse(header, func(token *jwt.Token) (interface{}, error) {
				return []byte(SecretKey), nil
			})

			if err != nil {
				resp["error"] = "unauthorized"
				if err.Error() == "Token is expired" {
					resp["message"] = err.Error()
					JSON(w, http.StatusUnauthorized, resp)
					return
				}
				resp["message"] = errorstring
				JSON(w, http.StatusUnauthorized, resp)
				log.Println(err.Error())
				return
			}

			claims, _ := token.Claims.(jwt.MapClaims)

			uid, err := strconv.Atoi(claims["uid"].(string))
			if err != nil {
				resp["error"] = "something unexpected occurred"
				JSON(w, http.StatusInternalServerError, resp)
				log.Println(err.Error())
				return
			}

			ctx := context.WithValue(r.Context(), "uid", uid) // adding the user ID to the context
			next.ServeHTTP(w, r.WithContext(ctx))

		})
	}
}

func main() {
  r := chi.NewRouter()

  r.Use(AuthJwtWrap(secretKey))
  r.Get("/", func(w http.ResponseWriter, r *http.Request) {
    w.Write([]byte("welcome"))
  })

  http.ListenAndServe(":3000", r)
}
```
</details>

<br>
<br>

<details><summary>Http Rate Limiting Middleware</summary>

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
</details>