# Architecture

chi is a small core package (`github.com/go-chi/chi/v5`) plus an optional `middleware` package. The core uses only the standard library.

| File | Lines | What it holds |
|---|---:|---|
| `chi.go` | ~140 | `NewRouter()` and the `Router` / `Routes` interfaces, `Middlewares`. |
| `mux.go` | ~540 | `Mux`: `Use`, `With`, `Group`, `Route`, `Mount`, method handlers, `ServeHTTP` and `routeHTTP`. |
| `tree.go` | ~925 | The radix tree: route patterns, `{param}` / regexp / `*` wildcard matching per HTTP method. |
| `context.go` | ~190 | `Context` (URL params, route pattern), `URLParam`, `RouteContext`. |
| `chain.go` | ~50 | `Chain()` and `ChainHandler` for composing inline middleware. |
| `middleware/` | | Optional handlers (`Logger`, `Recoverer`, `Timeout`, `Throttle`, `Compress`, `RealIP`, …). Only a few (`CleanPath`, `GetHead`, `Profiler`, `StripSlashes`, `URLFormat`, …) import the core package, to read the route context. |

## How a request flows
1. `Mux.ServeHTTP` takes a `Context` from a `sync.Pool`, resets it and stores it on the request (sub-routers reuse the parent's context).
2. `mx.handler` is the middleware stack built by `Use` wrapped around `routeHTTP`.
3. `routeHTTP` finds the route in the tree for the method and path, fills in URL params, and calls the handler (or the not-found / method-not-allowed handler). A `Mount`ed sub-router repeats this for the rest of the path.
4. The `Context` goes back to the pool afterwards.

---
<sub>Drafted with [RepoLens](https://github.com/CHAPIBUNNY/repolens), checked by hand.</sub>
