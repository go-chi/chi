# @deepseek-ai/dsh-web

English | [中文](README.zh.md)

The **`WebRuntime`** (`ctx.web`) defines WHAT web access the harness has — search the web, fetch a URL — over multiple providers, without binding the model contract to one vendor's API shape.

This package owns the Service Definition role of the web capability. Unlike shell/fs it spans two operations (search and fetch) on one seam, with potentially multiple providers each:

| Package | Role |
|---|---|
| `@deepseek-ai/dsh-web` (this) | Service Definition: the service, provider registries, selection policy, request/result vocabulary, the `WebError` taxonomy |
| `@deepseek-ai/dsh-web-search-exa` | Search provider: Exa |
| `@deepseek-ai/dsh-web-search-perplexity` | Search provider: Perplexity |
| `@deepseek-ai/dsh-web-fetch-http` | Fetch provider: anonymous public HTTP(S) |
| `@deepseek-ai/dsh-tool-web` | Consumer: the model-facing `web_search` / `web_fetch` tool schemas over `ctx.web` |

Search and fetch share no request schema and no business logic, but they are deliberately one seam: `ctx.web` is a single web-access middle layer with one provider-selection policy owner, one abort/error vocabulary, and one product-facing "how this harness reaches the web" config surface. The `Search`/`Fetch` method pairs are deliberately parallel.

## Service API (`ctx.web`)

| Member | Semantics |
|---|---|
| `registerSearchProvider(provider)` / `registerFetchProvider(provider)` | Register a backend. Throws `WebError` `WEB_DUPLICATE_PROVIDER` on a duplicate id within that capability kind. Returns a disposer. Disposed with the calling fiber. |
| `search(request, signal?)` | Resolve the search provider and run one search. Enforces `request.maxResults` on the result (truncates `sources[]`, sets `truncated`). Throws `WebError` when the capability cannot run. |
| `fetch(request, signal?)` | Resolve the fetch provider and retrieve one URL. A non-2xx response is a result, not a throw. Throws `WebError` for failures to safely retrieve or represent the resource. |

Providers register **capabilities**, not tools. `dsh-tool-web` is the only owner of model-facing names, descriptions, prompt guidance, JSON schemas, and presentation.

## Selection

Selection never depends on registration, config, or HMR order. A capability has an explicit provider id (config `searchProvider`/`fetchProvider`, or env `$DSH_WEB_SEARCH_PROVIDER`/`$DSH_WEB_FETCH_PROVIDER` feeding the same fields), or auto-selects when exactly one usable provider is registered. `search()`/`fetch()` resolve the provider at execution time:

| Situation | Execution |
|---|---|
| configured id registered and `available()` | runs that provider |
| configured id not registered | `WEB_PROVIDER_CONFIGURED_MISSING` |
| configured id registered but unavailable | `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` |
| no id, exactly one registered usable provider | runs it |
| no id, no usable provider | `WEB_PROVIDER_UNAVAILABLE` |
| no id, multiple usable providers | `WEB_PROVIDER_AMBIGUOUS` |

The failure branches throw `WebError`, whose structured code (plus message detail — the missing id, the ambiguous candidate set) is the direct callers route on. A provider's own `available()` is a cheap local check (credential presence, parseable config) that feeds this execution-time selection and **must not make network calls**; `dsh-tool-web` never calls it — the tool executes through `ctx.web.search()`/`fetch()` and routes on the thrown codes, so provider selection has one owner.

## Vocabulary

`WebSearchRequest` (`query`, `maxResults?`) → `WebSearchResult` (`content?`, `sources[]`, `truncated`); each `WebSearchSource` has a required `url` and optional `title`/`snippet`/`publishedAt` (Perplexity citations may be URL-only). `WebFetchRequest` (`url`) → `WebFetchResult` (final `url`, `statusCode`, `body`, `truncated`); cancellation is a direct optional `AbortSignal` argument to `search()`/`fetch()`. `WebFetchBody` is a CLOSED discriminated union (`html` | `text`) owned here — consumers `switch` to exhaustiveness so a new kind breaks their compilation until handled. See `src/types.ts` for the full contracts and the `WebError` code taxonomy.

## Model Experience

Indirectly, through `dsh-tool-web`, which retains bounded normalized provider data or the exact configured-provider, unavailable-provider, no-provider, multiple-provider, and `Error: <message>` failures while this registry contributes no prompt or schema itself.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **No observation surface** — no provider-change event and no capability-status query; availability is observed only by executing `search()`/`fetch()` and routing the thrown `WebError` codes, and the no-provider failure is the generic `WEB_PROVIDER_UNAVAILABLE` with no per-provider reason enumeration ([Agent Note](../../../.agents/notes/archived/simplification/2026-07-04-drop-unconsumed-web-observation-surface.md)).
- **`WebSearchRequest` carries only `query` + `maxResults`** — provider-neutral controls (recency, domain filters, regional hints, search depth) are deferred until Exa and Perplexity can both honor them honestly ([seam Agent Note](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md)).
- **`WebFetchBody` has no `pdf` arm** — text-extractable PDF support is named deferred work; the closed union makes adding it a compile-enforced change across the three web packages.
- **Provider-backed page extraction is out of scope of `fetch()`** — a Firecrawl/Tavily-style `web_extract` capability is deferred rather than widening the fetch operation.
