# @deepseek-ai/dsh-web-search-perplexity

English | [中文](README.zh.md)

A [Perplexity](https://perplexity.ai)-backed `WebSearchProvider` for the harness [web capability seam](../web/README.md) (`ctx.web`). It calls Perplexity's OpenAI-compatible `POST /chat/completions` endpoint and maps the generated answer plus citations into the seam's normalized `WebSearchResult`.

This is an **implementation** package: it registers a provider into `ctx.web`, it does not own the key and it does not register a model-facing tool. Like `@deepseek-ai/dsh-llm-deepseek`, it is a function/namespace plugin (`inject: ['web']`). The OpenAI-compatible wire shape is a provider-private detail — it does **not** make this provider depend on `ctx.llm`.

## Config

| Key | Default | Meaning |
|---|---|---|
| `apiKey` | `$PERPLEXITY_API_KEY` | Perplexity API key. Empty/absent makes the provider unavailable. |
| `baseURL` | `https://api.perplexity.ai` | Endpoint base; `/chat/completions` is appended. An unparseable value makes the provider unavailable. |
| `model` | `sonar` | Search model name. |
| `maxTokens` | `1024` | Upper bound on generated answer tokens (`max_tokens`). Must be a positive integer. |
| `searchRecency` | (unset) | Recency window sent as `search_recency_filter`: `day`, `week`, `month`, or `year`. Unset sends no filter. |

```yaml
- id: web-search-perplexity
  name: '@deepseek-ai/dsh-web-search-perplexity'
  config:
    apiKey: !!js process.env.PERPLEXITY_API_KEY
```

## Mapping

`content` ← `choices[0].message.content` (the generated answer). `sources[]` prefers the structured `search_results[]` (`url`, `title`, `snippet`, `publishedAt` ← `date`), falling back to the URL-only `citations[]` array only when `search_results` is absent — those sources carry just a `url`, which is why `title`/`snippet`/`publishedAt` are optional on the seam. Provider failures surface as `WebError` `WEB_PROVIDER_ERROR`; an aborted request surfaces as `WEB_ABORTED`. HTTP redirects are rejected before the `Location` target is contacted and surface as `WEB_PROVIDER_ERROR`. Perplexity has no result-count control, so `maxResults` is enforced by the seam (truncating `sources[]` and setting `truncated`).

## Model Experience

### Auxiliary Perplexity request

#### What the model sees

A separate Perplexity model receives `<query>` verbatim as its sole user message through the chat-completions endpoint. This request is not part of the conversation model's context.

#### Token effect

Separate provider tokens are incurred per search; `maxTokens` caps the generated answer.

#### KV Cache effect

Independent of the conversation request cache. An identical query under the same model route may reuse provider cache; a changed query or route establishes a different prefix.

### Conversation tool result, indirectly

#### What the model sees

Through [`dsh-tool-web`](../tool-web/README.md), the conversation model sees the generated answer plus structured result metadata or URL-only citations. This provider's exact failures are `Perplexity search aborted`, `Perplexity search request failed: <error>`, and `Perplexity returned an unprocessable response body: <error>`; HTTP failures preserve the provider message. The consumer owns the error wrapper.

#### Token effect

Zero direct conversation tokens from registration. Answer and source tokens are data-dependent, source count is service-bounded, and the retained result or error is resent until compaction.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **Citation-fallback sources are URL-only** — when Perplexity omits structured `search_results[]`, sources carry no `title`/`snippet`/`publishedAt`, so the tool renders bare hostname labels.
- **Over-returned sources still cost tokens and latency** — with no result-count control on the wire, `maxResults` is enforced only post-hoc by seam truncation.
- **Only `model`/`maxTokens`/`searchRecency` are exposed** — Perplexity's other search controls (domain filters, `web_search_options` context size, images) wait on provider-neutral Service Definition fields ([seam Agent Note](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md)).
- **Abort classification is error-shape-based** — only a `DOMException` named `AbortError` maps to `WEB_ABORTED`; an abort carrying a custom reason (e.g. `dsh-timeout`'s `TimeoutReason`) surfaces as `WEB_PROVIDER_ERROR`.
