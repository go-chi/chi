# Changelog

## v3.0.0 (2017-06-21)

- Major update to chi library with many exciting updates, but also some *breaking changes*
- URL parameter syntax changed from `/:id` to `/{id}` for even more flexible routing, such as
  `/articles/{month}-{day}-{year}-{slug}`, `/articles/{id}`, and `/articles/{id}.{ext}` on the
  same router
- Support for regexp for routing patterns, in the form of `/{paramKey:regExp}` for example:
  `r.Get("/articles/{name:[a-z]+}", h)` and `chi.URLParam(r, "name")`
- Add `Method` and `MethodFunc` to `chi.Router` to allow routing definitions such as
  `r.Method("GET", "/", h)` which provides a cleaner interface for custom handlers like
  in `_examples/custom-handler`
- Deprecating `mux#FileServer` helper function. Instead, we encourage users to create their
  own using file handler with the stdlib, see `_examples/fileserver` for an example
- Moved the chi project to its own organization, to allow chi-related community packages to
  be easily discovered and supported, at: https://github.com/go-chi
- NOTE: chi v2 is still available at https://github.com/go-chi/chi/tree/v2


## v2.1.0 (2017-03-30)

- Minor improvements and update to the chi core library
- Introduced a brand new `chi/render` sub-package to complete the story of building
  APIs to offer a pattern for managing well-defined request / response payloads. Please
  check out the updated `_examples/rest` example for how it works.
- Added `MethodNotAllowed(h http.HandlerFunc)` to chi.Router interface


## v2.0.0 (2017-01-06)

- After many months of v2 being in an RC state with many companies and users running it in
  production, the inclusion of some improvements to the middlewares, we are very pleased to
  announce v2.0.0 of chi.


## v2.0.0-rc1 (2016-07-26)

- Huge update! chi v2 is a large refactor targetting Go 1.7+. As of Go 1.7, the popular
  community `"net/context"` package has been included in the standard library as `"context"` and
  utilized by `"net/http"` and `http.Request` to managing deadlines, cancelation signals and other
  request-scoped values. We're very excited about the new context addition and are proud to
  introduce chi v2, a minimal and powerful routing package for building large HTTP services,
  with zero external dependencies. Chi focuses on idiomatic design and encourages the use of 
  stdlib HTTP handlers and middlwares.
- chi v2 deprecates its `chi.Handler` interface and requires `http.Handler` or `http.HandlerFunc`
- chi v2 stores URL routing parameters and patterns in the standard request context: `r.Context()`
- chi v2 lower-level routing context is accessible by `chi.RouteContext(r.Context()) *chi.Context`,
  which provides direct access to URL routing parameters, the routing path and the matching
  routing patterns.
- Users upgrading from chi v1 to v2, need to:
  1. Update the old chi.Handler signature, `func(ctx context.Context, w http.ResponseWriter, r *http.Request)` to
     the standard http.Handler: `func(w http.ResponseWriter, r *http.Request)`
  2. Use `chi.URLParam(r *http.Request, paramKey string) string`
     or `URLParamFromCtx(ctx context.Context, paramKey string) string` to access a url parameter value


## v1.0.0 (2016-07-01)

- Released chi v1 stable https://github.com/go-chi/chi/tree/v1.0.0 for Go 1.6 and older.


## v0.9.0 (2016-03-31)

- Reuse context objects via sync.Pool for zero-allocation routing [#33](https://github.com/go-chi/chi/pull/33)
- BREAKING NOTE: due to subtle API changes, previously `chi.URLParams(ctx)["id"]` used to access url parameters
  has changed to: `chi.URLParam(ctx, "id")`
