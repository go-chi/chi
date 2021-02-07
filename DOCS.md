chi, getting started
====================

Chi is a lightweight front-end to your HTTP server with it's sole job to help you handle HTTP requests.

With Chi, requests flow through a routing stack of (optional) middlewares and nested sub-routers,
all the way down to the final response handler. At any point down the chain of handlers, any of
the handlers may respond to the client and end the request flow.

Chi also comes with an expressive interface to allow you to specify different URL routing pattern
matchers, that as a request flows through, will mark the handler for processing of a request.

Chi is intentionally designed to not to try to do too much, and allow you to make your own opinions
on how you design your services. It's not a "web framework", but once you start putting together
all of its middlewares and your own patterns, it sure does feel as powerful as one. See the
[_examples]('./_examples) directory for some ideas on patterns you can compose with chi.


## Routing basics

**Routing an index page:**

```go
r := chi.NewRouter()
r.Get("/", func(w http.ResponseWriter, r *http.Request) {
  w.Write([]byte("index here"))
}
```

Note, in the above example we've inlined the http.HandlerFunc, however you can also define it
as a function and then reference it, like so:

```go
r := chi.NewRouter()
r.Get("/", indexHandler)

func indexHandler(w http.ResponseWriter, r *http.Request) {
  w.Write([]byte("index here"))
}
```


**Routing Page-Not-Found:**

```go
r := chi.NewRouter()
r.Get("/", indexHandler)
r.NotFound(func(w http.ResponseWriter, r *http.Request) {
  w.WriteHeader(404)
  w.Write([]byte("route does not exist"))
})
```

**Routing a POST request:**

```go
r := chi.NewRouter()
r.Post("/articles", createArticles)

func createArticles(w http.ResponseWriter, r *http.Request) {
  // ..
  w.WriteHeader(201)
})
```

**Routing other request methods:**

Chi allows you to route/handle any HTTP request method, such as all the usual suspects:
GET, POST, HEAD, PUT, PATCH, DELETE, OPTIONS, TRACE, CONNECT

These methods are defined on the `chi.Router` as:

```go
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
```

and may set a route by calling ie. `r.Put("/path", myHandler)`.

You may also register your own custom method names, by calling `chi.RegisterMethod("JELLO")`
and then setting the routing handler via `r.Method("JELLO", "/path", myJelloMethodHandler)`


## Routing patterns & url parameters

Each routing method accepts a URL `pattern` and chain of `handlers`. The URL pattern
supports named params (ie. `/users/{userID}`) and wildcards (ie. `/admin/*`). URL parameters
can be fetched at runtime by calling `chi.URLParam(r, "userID")` for named parameters
and `chi.URLParam(r, "*")` for a wildcard parameter.

**Routing a slug:**

```go
r := chi.NewRouter()
r.Get("/articles/{date}-{slug}", getArticle)

func getArticle(w http.ResponseWriter, r *http.Request) {
  dateParam := r.URLParam(r, "date")
  slugParam := r.URL(r, "slug")

  article, err := database.GetArticle(date, slug)
  if err != nil {
    w.WriteHeader(422)
    w.Write([]byte(fmt.Sprintf("error fetching article %s-%s: %v", dateParam, slugParam, err)))
    return
  }
  if article == nil {
    w.WriteHeader(404)
    w.Write([]byte("article not found"))
    return
  }

  w.Write([]byte(article.Text()))
})
```

as you can see above, the url parameters are defined using the curly brackets `{}` with the parameter
name in between, as `{date}` and `{slug}`. When a HTTP request is sent to the server and handled by
the chi router, if the URL path matches the format of "/articles/{date}-{slug}", then the `getArticle`
function will be called to send a response to the client.

For instance, URL paths like `/articles/20200109-this-is-so-cool` will be routed successfully.


## Middlewares

..


## Sub-routers

..


## What's next

auth, cors, etc..

..
