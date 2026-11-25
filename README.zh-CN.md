# <img alt="chi" src="https://cdn.rawgit.com/go-chi/chi/master/_examples/chi.svg" width="220" />


[![GoDoc Widget]][GoDoc]

> 本文档是 [README.md](README.md) 的简体中文翻译，若两者有出入，以英文原版为准。

`chi` 是一个轻量、地道且可组合的路由器，用于构建 Go HTTP 服务。它尤其擅长帮助你编写大型
REST API 服务，并在项目不断成长和变化的过程中保持其可维护性。`chi` 构建于 Go 1.7 引入的
新 `context` 包之上，用于在处理器链（handler chain）中传递信号、取消操作以及请求作用域的值。

本项目一直致力于为编写 REST API 服务器寻找一种优雅而舒适的设计。它诞生于 Pressly API
服务的开发过程中——该服务驱动着我们的公共 API，而公共 API 又支撑着我们所有的客户端应用。

chi 设计的核心考量是：项目结构、可维护性、标准 http 处理器（仅依赖标准库）、开发者生产力，
以及将大型系统拆解为许多小部分。核心路由器 `github.com/go-chi/chi` 非常小巧（不到 1000 行
代码），但我们还提供了一些实用/可选的子包：[middleware](/middleware)、[render](https://github.com/go-chi/render)
和 [docgen](https://github.com/go-chi/docgen)。希望你也喜欢它！

## 安装

```sh
go get -u github.com/go-chi/chi/v5
```


## 特性

* **轻量** - chi 路由器经 cloc 统计约 1000 行代码
* **快速** - 没错，参见[基准测试](#基准测试)
* **与 net/http 100% 兼容** - 可以使用生态中任何与 `net/http` 兼容的 http 或中间件包
* **为模块化/可组合的 API 而设计** - 中间件、内联中间件、路由组以及子路由器挂载
* **Context 控制** - 构建于新的 `context` 包之上，提供值的链式传递、取消与超时
* **健壮** - 已在 Pressly、Cloudflare、Heroku、99Designs 等众多公司的生产环境中使用（参见[讨论](https://github.com/go-chi/chi/issues/91)）
* **文档生成** - `docgen` 可从你的源码自动生成 JSON 或 Markdown 格式的路由文档
* **Go.mod 支持** - 自 v5 起支持 go.mod（参见 [CHANGELOG](https://github.com/go-chi/chi/blob/master/CHANGELOG.md)）
* **无外部依赖** - 纯粹的 Go 标准库 + net/http


## 示例

各种示例请参见 [_examples/](https://github.com/go-chi/chi/blob/master/_examples/)。


**简单到只需：**

```go
package main

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

func main() {
	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("welcome"))
	})
	http.ListenAndServe(":3000", r)
}
```

**REST 预览：**

下面小小地预览一下用 chi 编写路由是什么样子。也可以看看自动生成的路由文档，
有 JSON 格式（[routes.json](https://github.com/go-chi/chi/blob/master/_examples/rest/routes.json)）和
Markdown 格式（[routes.md](https://github.com/go-chi/chi/blob/master/_examples/rest/routes.md)）。

我强烈推荐阅读上面列出的[示例](https://github.com/go-chi/chi/blob/master/_examples/)源码，
它们会向你展示 chi 的全部特性，本身就是很好的文档。

```go
import (
  //...
  "context"
  "github.com/go-chi/chi/v5"
  "github.com/go-chi/chi/v5/middleware"
)

func main() {
  r := chi.NewRouter()

  // A good base middleware stack
  r.Use(middleware.RequestID)
  r.Use(middleware.ClientIPFromRemoteAddr) // pick one ClientIPFrom* based on your infra, see below
  r.Use(middleware.Logger)
  r.Use(middleware.Recoverer)

  // Set a timeout value on the request context (ctx), that will signal
  // through ctx.Done() that the request has timed out and further
  // processing should be stopped.
  r.Use(middleware.Timeout(60 * time.Second))

  r.Get("/", func(w http.ResponseWriter, r *http.Request) {
    w.Write([]byte("hi"))
  })

  // RESTy routes for "articles" resource
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


## Router 接口

chi 的路由器基于一种 [Patricia Radix trie（基数树）](https://en.wikipedia.org/wiki/Radix_tree)。
该路由器与 `net/http` 完全兼容。

构建在这棵树之上的是 `Router` 接口：

```go
// Router consisting of the core routing methods used by chi's Mux,
// using only the standard net/http.
type Router interface {
	http.Handler
	Routes

	// Use appends one or more middlewares onto the Router stack.
	Use(middlewares ...func(http.Handler) http.Handler)

	// With adds inline middlewares for an endpoint handler.
	With(middlewares ...func(http.Handler) http.Handler) Router

	// Group adds a new inline-Router along the current routing
	// path, with a fresh middleware stack for the inline-Router.
	Group(fn func(r Router)) Router

	// Route mounts a sub-Router along a `pattern` string.
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
	Query(pattern string, h http.HandlerFunc)
	Trace(pattern string, h http.HandlerFunc)

	// NotFound defines a handler to respond whenever a route could
	// not be found.
	NotFound(h http.HandlerFunc)

	// MethodNotAllowed defines a handler to respond whenever a method is
	// not allowed.
	MethodNotAllowed(h http.HandlerFunc)
}

// Routes interface adds two methods for router traversal, which is also
// used by the github.com/go-chi/docgen package to generate documentation for Routers.
type Routes interface {
	// Routes returns the routing tree in an easily traversable structure.
	Routes() []Route

	// Middlewares returns the list of middlewares in use by the router.
	Middlewares() Middlewares

	// Match searches the routing tree for a handler that matches
	// the method/path - similar to routing a http request, but without
	// executing the handler thereafter.
	Match(rctx *Context, method, path string) bool
}
```

每个路由方法都接受一个 URL `pattern`（模式）和一条 `handlers`（处理器）链。URL 模式
支持命名参数（如 `/users/{userID}`）和通配符（如 `/admin/*`）。运行时可以调用
`chi.URLParam(r, "userID")` 获取命名参数的值，调用 `chi.URLParam(r, "*")` 获取通配符参数的值。


### 中间件处理器

chi 的中间件就是标准库 net/http 的中间件处理器。它们没有任何特殊之处，这意味着路由器
及所有配套工具在设计上都与社区中的任何中间件兼容且友好。这带来了更好的可扩展性和包复用
能力，也是 chi 的核心宗旨所在。

下面是一个标准 net/http 中间件的示例，我们将 context 键 `"user"` 的值设为 `"123"`。
这个中间件在请求 context 上设置一个假想的用户标识符，然后调用链中的下一个处理器。

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


### 请求处理器

chi 使用标准的 net/http 请求处理器。下面这段小代码是一个 http.Handler 函数的示例，
它从请求 context 中读取用户标识符——假设该标识符用于识别发送已认证请求的用户，
由前面的中间件处理器验证并设置。

```go
// HTTP handler accessing data from the request context.
func MyRequestHandler(w http.ResponseWriter, r *http.Request) {
  // here we read from the request context and fetch out `"user"` key set in
  // the MyMiddleware example above.
  user := r.Context().Value("user").(string)

  // respond to the client
  w.Write([]byte(fmt.Sprintf("hi %s", user)))
}
```


### URL 参数

chi 的路由器会解析 URL 参数并直接存储到请求 context 上。下面的示例展示如何在你的
net/http 处理器中访问 URL 参数。当然，中间件也能访问同样的信息。

```go
// HTTP handler accessing the url routing parameters.
func MyRequestHandler(w http.ResponseWriter, r *http.Request) {
  // fetch the url parameter `"userID"` from the request of a matching
  // routing pattern. An example routing pattern could be: /users/{userID}
  userID := chi.URLParam(r, "userID")

  // fetch `"key"` from the request context
  ctx := r.Context()
  key := ctx.Value("key").(string)

  // respond to the client
  w.Write([]byte(fmt.Sprintf("hi %v, %v", userID, key)))
}
```


## 中间件

chi 自带一个可选的 `middleware` 包，提供了一套标准的 `net/http` 中间件。请注意，
生态中任何与 `net/http` 兼容的中间件都可以与 chi 的 mux 一起使用。

### 核心中间件

----------------------------------------------------------------------------------------------------
| chi/middleware 处理器  | 描述                                                                    |
| :--------------------- | :---------------------------------------------------------------------- |
| [AllowContentEncoding] | 强制校验请求 Content-Encoding 头的白名单                                |
| [AllowContentType]     | 显式白名单，限定可接受的请求 Content-Type                               |
| [BasicAuth]            | HTTP 基本认证                                                           |
| [Compress]             | 为接受压缩响应的客户端提供 Gzip 压缩                                    |
| [ContentCharset]       | 确保 Content-Type 请求头中的字符集                                      |
| [CleanPath]            | 清理请求路径中的双斜杠                                                  |
| [Deprecation]          | 设置 Deprecation 响应头（RFC 9745）；另见 [Sunset]                      |
| [GetHead]              | 自动将未定义的 HEAD 请求路由到 GET 处理器                               |
| [Heartbeat]            | 用于检测服务器心跳的监控端点                                            |
| [Logger]               | 记录每个请求的开始与结束及处理耗时                                      |
| [NoCache]              | 设置响应头以阻止客户端缓存                                              |
| [Profiler]             | 轻松将 net/http/pprof 挂载到你的路由器                                  |
| [ClientIPFromHeader]   | 从受信任的单 IP 头（X-Real-IP、CF-Connecting-IP 等）获取客户端 IP       |
| [ClientIPFromXFF]      | 从 X-Forwarded-For 获取客户端 IP，跳过列出的受信任 CIDR 前缀            |
| [ClientIPFromXFFTrustedProxies] | 在受信任代理数量固定的情况下，从 X-Forwarded-For 获取客户端 IP |
| [ClientIPFromRemoteAddr] | 从 TCP RemoteAddr 获取客户端 IP（服务器直接暴露在公网）               |
| [RealIP]               | 已弃用——易受 IP 欺骗攻击；请使用 [ClientIPFromXFF] 或其他 ClientIPFrom\* 中间件 |
| [Recoverer]            | 优雅地捕获 panic 并打印堆栈跟踪                                         |
| [RequestID]            | 向每个请求的 context 注入请求 ID                                        |
| [RedirectSlashes]      | 对路由路径上的斜杠进行重定向                                            |
| [RouteHeaders]         | 基于请求头的路由处理                                                    |
| [SetHeader]            | 设置响应头键/值的快捷中间件                                             |
| [StripSlashes]         | 去除路由路径上的斜杠                                                    |
| [Sunset]               | 设置 Sunset 响应头（RFC 8594）；另见 [Deprecation]                      |
| [Throttle]             | 限制并发请求数量的上限                                                  |
| [Timeout]              | 到达超时期限时向请求 context 发出信号                                   |
| [URLFormat]            | 从 URL 解析扩展名并放入请求 context                                     |
| [WithValue]            | 在请求 context 上设置键/值的快捷中间件                                  |
----------------------------------------------------------------------------------------------------

[AllowContentEncoding]: https://pkg.go.dev/github.com/go-chi/chi/v5/middleware#AllowContentEncoding
[AllowContentType]: https://pkg.go.dev/github.com/go-chi/chi/v5/middleware#AllowContentType
[BasicAuth]: https://pkg.go.dev/github.com/go-chi/chi/v5/middleware#BasicAuth
[Compress]: https://pkg.go.dev/github.com/go-chi/chi/v5/middleware#Compress
[ContentCharset]: https://pkg.go.dev/github.com/go-chi/chi/v5/middleware#ContentCharset
[CleanPath]: https://pkg.go.dev/github.com/go-chi/chi/v5/middleware#CleanPath
[Deprecation]: https://pkg.go.dev/github.com/go-chi/chi/v5/middleware#Deprecation
[GetHead]: https://pkg.go.dev/github.com/go-chi/chi/v5/middleware#GetHead
[GetReqID]: https://pkg.go.dev/github.com/go-chi/chi/v5/middleware#GetReqID
[Heartbeat]: https://pkg.go.dev/github.com/go-chi/chi/v5/middleware#Heartbeat
[Logger]: https://pkg.go.dev/github.com/go-chi/chi/v5/middleware#Logger
[NoCache]: https://pkg.go.dev/github.com/go-chi/chi/v5/middleware#NoCache
[Profiler]: https://pkg.go.dev/github.com/go-chi/chi/v5/middleware#Profiler
[ClientIPFromHeader]: https://pkg.go.dev/github.com/go-chi/chi/v5/middleware#ClientIPFromHeader
[ClientIPFromXFF]: https://pkg.go.dev/github.com/go-chi/chi/v5/middleware#ClientIPFromXFF
[ClientIPFromXFFTrustedProxies]: https://pkg.go.dev/github.com/go-chi/chi/v5/middleware#ClientIPFromXFFTrustedProxies
[ClientIPFromRemoteAddr]: https://pkg.go.dev/github.com/go-chi/chi/v5/middleware#ClientIPFromRemoteAddr
[GetClientIP]: https://pkg.go.dev/github.com/go-chi/chi/v5/middleware#GetClientIP
[GetClientIPAddr]: https://pkg.go.dev/github.com/go-chi/chi/v5/middleware#GetClientIPAddr
[RealIP]: https://pkg.go.dev/github.com/go-chi/chi/v5/middleware#RealIP
[Recoverer]: https://pkg.go.dev/github.com/go-chi/chi/v5/middleware#Recoverer
[RedirectSlashes]: https://pkg.go.dev/github.com/go-chi/chi/v5/middleware#RedirectSlashes
[RequestLogger]: https://pkg.go.dev/github.com/go-chi/chi/v5/middleware#RequestLogger
[RequestID]: https://pkg.go.dev/github.com/go-chi/chi/v5/middleware#RequestID
[RouteHeaders]: https://pkg.go.dev/github.com/go-chi/chi/v5/middleware#RouteHeaders
[SetHeader]: https://pkg.go.dev/github.com/go-chi/chi/v5/middleware#SetHeader
[StripSlashes]: https://pkg.go.dev/github.com/go-chi/chi/v5/middleware#StripSlashes
[Sunset]: https://pkg.go.dev/github.com/go-chi/chi/v5/middleware#Sunset
[Throttle]: https://pkg.go.dev/github.com/go-chi/chi/v5/middleware#Throttle
[ThrottleBacklog]: https://pkg.go.dev/github.com/go-chi/chi/v5/middleware#ThrottleBacklog
[ThrottleWithOpts]: https://pkg.go.dev/github.com/go-chi/chi/v5/middleware#ThrottleWithOpts
[Timeout]: https://pkg.go.dev/github.com/go-chi/chi/v5/middleware#Timeout
[URLFormat]: https://pkg.go.dev/github.com/go-chi/chi/v5/middleware#URLFormat
[WithLogEntry]: https://pkg.go.dev/github.com/go-chi/chi/v5/middleware#WithLogEntry
[WithValue]: https://pkg.go.dev/github.com/go-chi/chi/v5/middleware#WithValue
[Compressor]: https://pkg.go.dev/github.com/go-chi/chi/v5/middleware#Compressor
[DefaultLogFormatter]: https://pkg.go.dev/github.com/go-chi/chi/v5/middleware#DefaultLogFormatter
[EncoderFunc]: https://pkg.go.dev/github.com/go-chi/chi/v5/middleware#EncoderFunc
[HeaderRoute]: https://pkg.go.dev/github.com/go-chi/chi/v5/middleware#HeaderRoute
[HeaderRouter]: https://pkg.go.dev/github.com/go-chi/chi/v5/middleware#HeaderRouter
[LogEntry]: https://pkg.go.dev/github.com/go-chi/chi/v5/middleware#LogEntry
[LogFormatter]: https://pkg.go.dev/github.com/go-chi/chi/v5/middleware#LogFormatter
[LoggerInterface]: https://pkg.go.dev/github.com/go-chi/chi/v5/middleware#LoggerInterface
[ThrottleOpts]: https://pkg.go.dev/github.com/go-chi/chi/v5/middleware#ThrottleOpts
[WrapResponseWriter]: https://pkg.go.dev/github.com/go-chi/chi/v5/middleware#WrapResponseWriter

### 选择 ClientIP 中间件

旧版 [RealIP] 中间件已弃用——它易受 IP 欺骗攻击
（GHSA-3fxj-6jh8-hvhx、GHSA-rjr7-jggh-pgcp、GHSA-9g5q-2w5x-hmxf），并且会修改
`r.RemoteAddr`。请改用四个 `ClientIPFrom*` 中间件之一——根据你的网络环境只选择
其中一个——并通过 [GetClientIP]（string）或 [GetClientIPAddr]（`netip.Addr`）
读取解析出的 IP：

| 你的部署环境 | 使用 |
|---|---|
| 直接暴露在公网，无代理 | `middleware.ClientIPFromRemoteAddr` |
| 位于 nginx（`X-Real-IP`）、Cloudflare（`CF-Connecting-IP`）、Apache（`X-Client-IP`）之后 | `middleware.ClientIPFromHeader("<your-trusted-header>")` |
| 位于一个或多个代理之后，且可列出其 IP 段 | `middleware.ClientIPFromXFF("10.0.0.0/8", ...)` |
| 位于数量已知且固定、IP 动态变化的代理之后 | `middleware.ClientIPFromXFFTrustedProxies(2)` |

```go
r := chi.NewRouter()
r.Use(middleware.RequestID)

// Pick exactly one. Examples for common deployments:

// Direct internet exposure (no proxy):
// r.Use(middleware.ClientIPFromRemoteAddr)

// Behind Cloudflare:
// r.Use(middleware.ClientIPFromHeader("CF-Connecting-IP"))

// Behind AWS CloudFront (or any proxy fleet with known CIDRs):
r.Use(middleware.ClientIPFromXFF(
    "13.32.0.0/15",   // CloudFront IPv4
    "52.46.0.0/18",   // CloudFront IPv4
    "2600:9000::/28", // CloudFront IPv6
))

// Behind a known number of proxies with dynamic IPs:
// r.Use(middleware.ClientIPFromXFFTrustedProxies(2))

r.Use(middleware.Logger)
r.Use(middleware.Recoverer)

r.Get("/", func(w http.ResponseWriter, r *http.Request) {
    clientIP := middleware.GetClientIP(r.Context()) // for logs, rate-limit keys, etc.
    _ = clientIP
})
```

这些中间件从不修改 `r.RemoteAddr`。它们将规范化的 `netip.Addr` 存入请求 context——
IPv4 映射的 IPv6 地址（`::ffff:a.b.c.d`）会被折叠为纯 IPv4，请求头中携带的 IPv6
zone 标识符会被剥离，因此同一个逻辑客户端在日志、限流和 ACL 中始终对应唯一的规范键。

对于 `ClientIPFromXFFTrustedProxies`，`numTrustedProxies` 是客户端与服务器之间的
代理跳数总和。只要可行，优先使用带显式 CIDR 的 `ClientIPFromXFF`——基于 CIDR 的
信任不会出现差一（off-by-one）错误。部署示例与验证清单请参见 godoc。

各中间件的完整语义请参见对应函数的 godoc；底层威胁模型可阅读
[adam-p 的《The perils of the 'real' client IP》](https://adam-p.ca/blog/2022/03/x-forwarded-for/)。

### 弃用与移除路由

先使用 `Deprecation`。当确定移除日期后，再加上 `Sunset`。

| 场景                                                     | 使用                        |
| :------------------------------------------------------- | :-------------------------- |
| 路由仍可用，客户端应迁移，但尚无移除日期                 | `Deprecation`               |
| 已知路由停止工作的日期                                   | `Deprecation` + `Sunset`    |
| 路由已被移除                                             | 都不用。返回 `410 Gone`。   |

```go
// A bad date parses to the zero time, and the middleware panics at startup.
deprecatedAt, _ := time.Parse(time.DateOnly, "2026-01-15")
sunsetAt, _ := time.Parse(time.DateOnly, "2026-07-01")

// Step 1: the route is deprecated.
r.With(middleware.Deprecation(deprecatedAt)).Get("/v1/users", listUsers)

// Step 2: the removal date is known.
r.With(middleware.Deprecation(deprecatedAt), middleware.Sunset(sunsetAt)).Get("/v1/users", listUsers)

// After sunsetAt: remove the route, or return 410 Gone.
```

### 更多中间件与扩展包

更多扩展包请参见 https://github.com/go-chi。

--------------------------------------------------------------------------------------------------------------------
| 包                                                 | 描述                                                        |
|:---------------------------------------------------|:-------------------------------------------------------------
| [cors](https://github.com/go-chi/cors)             | 跨域资源共享（CORS）                                        |
| [docgen](https://github.com/go-chi/docgen)         | 在运行时打印 chi.Router 的路由                              |
| [jwtauth](https://github.com/go-chi/jwtauth)       | JWT 认证                                                    |
| [hostrouter](https://github.com/go-chi/hostrouter) | 基于域名/主机的请求路由                                     |
| [httplog](https://github.com/go-chi/httplog)       | 小巧而强大的结构化 HTTP 请求日志                            |
| [httprate](https://github.com/go-chi/httprate)     | HTTP 请求限流器                                             |
| [httptracer](https://github.com/go-chi/httptracer) | HTTP 请求性能追踪库                                         |
| [httpvcr](https://github.com/go-chi/httpvcr)       | 为外部依赖编写确定性测试                                    |
| [stampede](https://github.com/go-chi/stampede)     | HTTP 请求合并器                                             |
--------------------------------------------------------------------------------------------------------------------


## context？

`context` 是一个小巧的包，提供了在调用栈和 goroutine 之间传递 context 信号的简单接口。
它最初由 [Sameer Ajmani](https://github.com/Sajmani) 编写，自 go1.7 起进入标准库。

了解更多：https://blog.golang.org/context

以及……
* 文档：https://golang.org/pkg/context
* 源码：https://github.com/golang/go/tree/master/src/context


## 基准测试

基准测试套件：https://github.com/pkieltyka/go-http-routing-benchmark

以下结果于 2020 年 11 月 29 日在 Linux AMD 3950x 上使用 Go 1.15.5 测得

```shell
BenchmarkChi_Param          	3075895	        384 ns/op	      400 B/op      2 allocs/op
BenchmarkChi_Param5         	2116603	        566 ns/op	      400 B/op      2 allocs/op
BenchmarkChi_Param20        	 964117	       1227 ns/op	      400 B/op      2 allocs/op
BenchmarkChi_ParamWrite     	2863413	        420 ns/op	      400 B/op      2 allocs/op
BenchmarkChi_GithubStatic   	3045488	        395 ns/op	      400 B/op      2 allocs/op
BenchmarkChi_GithubParam    	2204115	        540 ns/op	      400 B/op      2 allocs/op
BenchmarkChi_GithubAll      	  10000	     113811 ns/op	    81203 B/op    406 allocs/op
BenchmarkChi_GPlusStatic    	3337485	        359 ns/op	      400 B/op      2 allocs/op
BenchmarkChi_GPlusParam     	2825853	        423 ns/op	      400 B/op      2 allocs/op
BenchmarkChi_GPlus2Params   	2471697	        483 ns/op	      400 B/op      2 allocs/op
BenchmarkChi_GPlusAll       	 194220	       5950 ns/op	     5200 B/op     26 allocs/op
BenchmarkChi_ParseStatic    	3365324	        356 ns/op	      400 B/op      2 allocs/op
BenchmarkChi_ParseParam     	2976614	        404 ns/op	      400 B/op      2 allocs/op
BenchmarkChi_Parse2Params   	2638084	        439 ns/op	      400 B/op      2 allocs/op
BenchmarkChi_ParseAll       	 109567	      11295 ns/op	    10400 B/op     52 allocs/op
BenchmarkChi_StaticAll      	  16846	      71308 ns/op	    62802 B/op    314 allocs/op
```

与其他路由器的对比：https://gist.github.com/pkieltyka/123032f12052520aaccab752bd3e78cc

注意：上面基准测试中的内存分配来自对 http.Request 的 `WithContext(context.Context)`
方法的调用——该方法会克隆 http.Request，在复制出的（新分配的）请求上设置 `Context()`，
然后返回新的请求对象。这就是 Go 中为请求设置 context 的工作方式。


## 致谢

* 感谢 Carl Jackson 的 https://github.com/zenazn/goji
  * chi 的部分设计思想来自 goji，chi 的 middleware 包源码源自
    [goji](https://github.com/zenazn/goji/tree/master/web/middleware)。
  * 请参见 goji 的 [LICENSE](https://github.com/zenazn/goji/blob/master/LICENSE)（MIT）
* 感谢 Armon Dadgar 的 https://github.com/armon/go-radix
* 贡献者：[@VojtechVitek](https://github.com/VojtechVitek)

我们非常乐意看到[你的贡献](./CONTRIBUTING.md)！


## REST 之外

chi 只是一个 http 路由器，让你把请求处理拆分成许多更小的层次。许多公司用 chi 为其
公共 API 编写 REST 服务。但 REST 只是一种通过 HTTP 管理状态的约定，要构建完整的
客户端-服务器系统或微服务网络，还需要许多其他组件。

在 REST 之外，我也推荐该领域的一些较新的作品：
* [webrpc](https://github.com/webrpc/webrpc) - 面向 Web、带代码生成的 RPC 客户端+服务器框架
* [gRPC](https://github.com/grpc/grpc-go) - Google 基于 protobufs 的 RPC 框架
* [graphql](https://github.com/99designs/gqlgen) - 声明式查询语言
* [NATS](https://nats.io) - 轻量级发布-订阅


## 许可证

版权所有 (c) 2015-至今 [Peter Kieltyka](https://github.com/pkieltyka)

基于 [MIT 许可证](./LICENSE)授权

[GoDoc]: https://pkg.go.dev/github.com/go-chi/chi/v5
[GoDoc Widget]: https://godoc.org/github.com/go-chi/chi?status.svg
[Travis]: https://travis-ci.org/go-chi/chi
[Travis Widget]: https://travis-ci.org/go-chi/chi.svg?branch=master