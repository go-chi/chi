# 🔌 Routing

## Introduction

> Routing refers to how an application's endpoints (URIs) respond to client requests.

`Chi` allows you to route/handle any HTTP request method, such as all the usual suspects:
GET, POST, HEAD, PUT, PATCH, DELETE, OPTIONS, TRACE, CONNECT

## Handling HTTP Request Methods


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

Each routing method accepts a URL `pattern` and chain of `handlers`.

The URL pattern supports named params (ie. `/users/{userID}`) and wildcards (ie. `/admin/*`).

URL parameters can be fetched at runtime by calling `chi.URLParam(r, "userID")` for named parameters and `chi.URLParam(r, "*")` for a wildcard parameter.

**Routing a slug:**

```go
r := chi.NewRouter()

r.Get("/articles/{date}-{slug}", getArticle)

func getArticle(w http.ResponseWriter, r *http.Request) {
  dateParam := chi.URLParam(r, "date")
  slugParam := chi.URL(r, "slug")
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

as you can see above, the url parameters are defined using the curly brackets `{}` with the parameter name in between, as `{date}` and `{slug}`.

When a HTTP request is sent to the server and handled by the chi router, if the URL path matches the format of `/articles/{date}-{slug}`, then the `getArticle` function will be called to send a response to the client.

For instance, URL paths like `/articles/20200109-this-is-so-cool` will match the route, however,
`/articles/1` will not.

We can also use regex in url patterns

For Example:
```go
r := chi.NewRouter()
r.Get("/articles/{rid:^[0-9]{5,6}}", getArticle)
```

## Making Custom 404 and 405 Handlers

You can create Custom `http.StatusNotFound` and `http.StatusMethodNotAllowed` handlers in `chi`
```go
r.NotFound(func(w http.ResponseWriter, r *http.Request) {
  w.WriteHeader(404)
  w.Write([]byte("route does not exist"))
})
r.MethodNotAllowed(func(w http.ResponseWriter, r *http.Request) {
  w.WriteHeader(405)
  w.Write([]byte("method is not valid"))
})
```

## Sub Routers

You can create New Routers and Mount them on the Main Router to act as Sub Routers.

For Example:
```go
func main(){
    r := chi.NewRouter()
    r.Get("/", func(w http.ResponseWriter, r *http.Request) {
        w.Write([]byte("Hello World!"))
    })

    // Creating a New Router
    apiRouter := chi.NewRouter()
    apiRouter.Get("/articles/{date}-{slug}", getArticle)

    // Mounting the new Sub Router on the main router
    r.Mount("/api", apiRouter)
}
```

Another Way of Implementing Sub Routers would be:
```go
r.Route("/articles", func(r chi.Router) {
    r.With(paginate).Get("/", listArticles)                           // GET /articles
    r.With(paginate).Get("/{month}-{day}-{year}", listArticlesByDate) // GET /articles/01-16-2017

    r.Post("/", createArticle)                                        // POST /articles
    r.Get("/search", searchArticles)                                  // GET /articles/search

    // Regexp url parameters:
    r.Get("/{articleSlug:[a-z-]+}", getArticleBySlug)                // GET /articles/home-is-toronto

    // Subrouters:
    r.Route("/{articleID}", func(r chi.Router) {
      r.Use(ArticleCtx)
      r.Get("/", getArticle)                                          // GET /articles/123
      r.Put("/", updateArticle)                                       // PUT /articles/123
      r.Delete("/", deleteArticle)                                    // DELETE /articles/123
    })
  })
```

## Routing Groups

You can create Groups in Routers to segregate routes using a middleware and some not using a middleware

for example:
```go
func main(){
    r := chi.NewRouter()
    
    // Public Routes
    r.Group(func(r chi.Router) {
		r.Get("/", HelloWorld)
		r.Get("/{AssetUrl}", GetAsset)
		r.Get("/manage/url/{path}", FetchAssetDetailsByURL)
		r.Get("/manage/id/{path}", FetchAssetDetailsByID)
	})

	// Private Routes
    // Require Authentication
	r.Group(func(r chi.Router) {
		r.Use(AuthMiddleware)
		r.Post("/manage", CreateAsset)
	})

}
```

