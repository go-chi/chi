# @deepseek-ai/dsh-llm-deepseek

English | [中文](README.zh.md)

DeepSeek chat-completions adapter for the harness LLM seam: direct `fetch` + SSE (framed by `eventsource-parser`) translating the official wire format (source of truth: the API docs — guides/thinking_mode, guides/tool_calls, api/create-chat-completion) into the `StreamChunk` protocol.

A second, library-backed implementation of the same seam exists in `@deepseek-ai/dsh-llm-pi-ai`. This package owns the `deepseek-official` provider route — deliberately distinct from pi-ai's catalog name `deepseek`, so one composition can mount both DeepSeek paths side by side; registering another adapter for `deepseek-official` itself still throws `LlmError('DUPLICATE_ADAPTER')`.

The package root exposes the Cordis plugin contract and `DeepSeekAdapter`; wire serialization, SSE parsing, and chunk translation helpers are not part of that root contract.

## Config

```yaml
- id: llm-deepseek
  name: '@deepseek-ai/dsh-llm-deepseek'
  config:
    apiKeyEnv: DEEPSEEK_API_KEY  # default; resolved per request via ctx.credentials, then the environment
    baseURL: https://api.deepseek.com # optional; $DEEPSEEK_BASE_URL then the public API when omitted
    thinking: enabled        # optional; provider default is enabled
    reasoningEffort: high    # optional; off | low | high | max — omitted ⇒ high
    maxTokens: 256000        # optional positive per-request output cap; this is the default
    streamIdleTimeoutMs: 300000 # optional; positive finite Node timer delay; five-minute default
    retryPolicy:             # optional; omission uses bounded normal defaults
      mode: always           # normal | always
      backoff:
        initialDelayMs: 500
        maxDelayMs: 10000
        jitterRatio: 0.1
    defaultContextWindow: 1000000 # optional positive-integer fallback; this is the default
    models:                  # optional; defaults to V4 Flash and V4 Pro
      - id: deepseek-v4-flash
        name: DeepSeek-V4-Flash
      - id: private-reasoner
        description: Company-hosted reasoning model
        contextWindow: 512000
```

The plugin registers the single provider route `deepseek-official` together with its resolved `retryPolicy`. A request selects it with `provider: deepseek-official`; its `model` is passed through as the wire `model` string, so changing DeepSeek models does not require lifecycle-time registration. Omitting `models` advertises `deepseek-v4-flash` as `DeepSeek-V4-Flash` and `deepseek-v4-pro` as `DeepSeek-V4-Pro`, each with a 1,000,000-token context window; an explicit list replaces those defaults, while `models: []` advertises none. Catalog entries are exposed through `ctx.llm.listModels('deepseek-official')` for clients such as ACP editors and the Web selector, but remain advisory: unlisted model ids still pass through unchanged. An omitted entry name defaults to its id.

`contextWindow` is optional per configured model and is not exposed through the advisory catalog. `ctx.llm.resolveModelInfo('deepseek-official', model).context` returns an exact model value first, then `defaultContextWindow` for an entry without capacity or an unlisted pass-through id. The adapter default is 1,000,000; pressure-sensitive plugins therefore get deployment-owned capacity without treating the model selector as authoritative. Registering another adapter for `deepseek-official` throws `LlmError('DUPLICATE_ADAPTER')`.

`maxTokens` is the adapter-configured output cap for conversation requests and defaults to 256,000. A catalog entry may carry its own `maxTokens`, which wins for that model; an entry without one, and any unlisted pass-through id, resolve to the profile value, so adding a per-model cap changes one model rather than the route. Exact-model resolution exposes the winner as `defaultMaxTokens`; `LlmRuntime` materializes that value into `GenerateOptions.maxTokens` before the agent loop writes `request/header`, so the wire request remains reconstructable. An explicit request or `AgentOptions.maxTokens` value wins and is serialized as `max_tokens`. The adapter does not clamp this request budget against `contextWindow`; deployments with a smaller context or provider output limit must configure a compatible `maxTokens`.

The same exact-model result exposes ordered `off`, `low`, `high`, and `max` efforts under `reasoning` for every pass-through model when deployment policy permits thinking. `reasoningEffort` selects the deployment default and falls back to `high` when omitted. `agent/request` can replace it on each conversation step; the resolved value is logged in `request/header`. `low`, `high`, and `max` enable thinking and serialize as the same official top-level `reasoning_effort` value; adapter-owned `off` instead serializes `thinking.type: disabled` and omits `reasoning_effort`. An unsupported value fails with `UNSUPPORTED_REASONING_EFFORT` before network I/O.

`thinking: disabled` is a deployment lock that publishes only `off` with `off` as its default. Omitting `reasoningEffort` or configuring it as `off` is valid; configuring `low`, `high`, or `max` fails plugin loading, and a direct per-request attempt to enable thinking fails before network I/O. A request with `GenerateOptions.purpose: 'session-title'` also forces thinking disabled and omits the already-resolved effort, reserving its bounded output for visible title text without changing conversation or compaction defaults.

`streamIdleTimeoutMs` bounds each outstanding provider read, including the initial `fetch`, without counting time the consumer spends between chunks. DeepSeek SSE comments rearm an outstanding read as transport activity but never become `StreamChunk` values or session-log events. One stable abort signal reaches the request and body reader for the whole call; expiry stops the transport and throws `LlmError('TIMEOUT')`, while an earlier caller abort throws `LlmError('ABORTED')`. The adapter makes exactly one provider request per `stream()` call; it registers the configured policy as provider metadata, and `dsh-llm-retry` separately executes it at durable agent-step boundaries.

## Dynamic configuration (settings + credentials)

Connection facts are not frozen at load. `resolveAdapterOptions` is the one explicit resolve step from raw config to validated facts, and the adapter re-reads them through a thunk **once per operation**: base URL, catalog, request defaults, and idle budget all take effect on the next request, while an in-flight stream keeps the facts it started with. Two optional seams feed that thunk:

- **`ctx.settings`** — the plugin registers the `llm-deepseek` namespace with this same `Config` schema and its `cordis.yml` entry as the composition `base`, so a `llm-deepseek:` section in the user settings document overrides any field without a restart. Without a mounted settings service the entry config alone drives the adapter, unchanged. A live settings snapshot that passes the schema but fails a beyond-schema bound (a duplicate catalog id, a broken thinking/effort pair) keeps the last good facts and logs the failure; the entry config itself still fails plugin load.
- **`ctx.credentials`** — the API key resolves per stream call, from the *same* resolved snapshot that supplies the endpoint. Configuration carries only `apiKeyEnv`, never a literal key: the reference resolves through the credential seam, and without a mounted seam through the trusted environment layers. Because credential facts travel with the connection facts, a settings snapshot the resolver rejects contributes neither its endpoint nor its key: the whole previous generation keeps serving. Every resolved key is format-checked before use, so a value no HTTP header can carry is refused with `LlmError('INVALID_CREDENTIAL')` naming the failing entry point — never any part of the key — instead of surfacing as an opaque `fetch` `TypeError`. A request with no key anywhere fails with `MISSING_CREDENTIAL` naming every configuration entry point, while the route stays registered and the catalog stays browsable — first-run onboarding is "browse models, store the key, prompt again", with no restart between.

The one registration-captured fact is the retry policy: when its resolved value changes, the plugin re-registers the route in place (same adapter instance, one synchronous section), so `ctx.llm.providerRetryPolicy('deepseek-official')` always reports the current policy.

The plugin also declares its route in the configurable-provider directory (`ctx.llm.listConfigurableProviders()`): provider `deepseek-official`, settings namespace `llm-deepseek`, empty settings path — the whole section is the profile. Configuration surfaces use that entry to offer this adapter alongside dormant pi-ai providers.

## App attribution

Every request carries the shared attribution header from dsh-llm's `attributionHeaders()` - the mandatory `User-Agent` baseline identifying the harness (see [dsh-llm § App attribution](../llm/README.md#app-attribution-attributionts)). Direct DeepSeek requests and OpenAI-compatible gateway requests get no provider-specific app-attribution headers under this adapter contract; OpenRouter app attribution is deferred to a future explicit OpenRouter adapter or mode. A request whose `GenerateOptions.purpose` is `compaction` (dsh-compaction-basic's auxiliary summarization call) additionally carries `x-deepseek-harness-compact: 1`, so the host can separate compaction traffic from conversation requests.

DeepSeek request identity is separate from app attribution. After credential resolution, every provider request carries `x-deepseek-harness-user-id` with the stable anonymous id from [`@deepseek-ai/dsh-anonymous-user-id`](../../identity/anonymous-user-id/README.md); a request carrying `GenerateOptions.sessionId` also sends that exact value as `x-deepseek-harness-session-id`, while a direct call without a session omits the session header. Both headers go to the resolved `baseURL`, including a configured gateway, and remain outside the request body and model-visible content.

## Wire-format notes

- Streaming only (`stream_options.include_usage` always on). `usage` may arrive attached to the finish chunk or as a trailing usage-only chunk — the translator defers both to `[DONE]`, so `usage` always precedes `finish` and nothing follows `finish`.
- The adapter-owned `off` effort maps to `thinking: {type: 'disabled'}` and never crosses the wire as `reasoning_effort: 'off'`.
- The first thinking-mode chunk carries `reasoning_content: ""` — handled (no spurious reasoning block).
- **Reasoning passback rule**: on assistant turns that carried tool calls, `reasoning_content` is serialized back in history (required by the API in thinking mode); on tool-call-free turns it is dropped (ignored anyway — saves tokens).
- Cache accounting: `cacheReadTokens` ← `prompt_cache_hit_tokens` / `prompt_tokens_details.cached_tokens`; DeepSeek reports no cache-write metric.

## Errors

Non-2xx responses throw `LlmError` with stable codes: `AUTH` (401/403), `QUOTA` (a response whose provider details identify exhausted quota, balance, or credits), `RATE_LIMIT` (other 429s), `CONTEXT_WINDOW_EXCEEDED` (a 400 whose provider code, type, or message identifies context overflow), `INVALID_REQUEST` (other 400s), `SERVER` (5xx), `HTTP_<status>` otherwise. Its serializable `failure` retains the HTTP status plus a valid positive `Retry-After` seconds/date delay and `x-request-id` / `x-deepseek-request-id` when present. A pre-response transport failure (DNS, refused connection, TLS, proxy) throws `TRANSPORT` naming the configured endpoint and chaining the original rejection as `cause`; caller aborts throw `ABORTED`, and the loop's cancellation signal remains authoritative. Protocol violations throw `STREAM_CLOSED` (no `[DONE]`) or `MALFORMED_RESPONSE` (bad JSON payload). Unknown wire `finish_reason`s (e.g. `content_filter`, `insufficient_system_resource`) become `finish {kind: 'error', failure}` chunks, and a completed stream whose `stop` (or absent) finish opened no content blocks becomes a `finish {kind: 'error'}` with code `EMPTY_RESPONSE` (retried by default policy).

## Model Experience

### DeepSeek request

#### What the model sees

The selected DeepSeek model receives the harness system prompt, message history, tool schemas, stop sequences, and call config without adapter-authored prompt prose. On a prior assistant turn with tool calls, its reasoning content is passed back as required; reasoning from tool-call-free turns is omitted.

#### Token effect

Provider tokenization governs exact input. Conditional reasoning passback increases tool-round-trip context, while dropping other reasoning avoids paying those tokens again; cache-read usage is reported when available.

#### KV Cache effect

An unchanged assembled prefix is eligible for DeepSeek cache reuse, which this adapter reports in usage. A model-route change or any upstream prompt, schema, prefix, or history change may prevent reuse from the first changed token; reasoning passback appends during tool round trips.

### DeepSeek response

#### What the model sees

Reasoning, text, and raw-string tool arguments are translated into harness chunks for the loop to log and assemble.

#### Token effect

Generated tokens follow the request's logged reasoning effort and `maxTokens`; only loop-retained blocks affect later input.

#### KV Cache effect

Loop-retained response blocks append to the next request and preserve its earlier reusable prefix; dropped blocks have no later cache effect. Changing the provider or model selects a different cache domain.

## Known Limitations and Deferred Work

- **A settings `models` list replaces the composition list wholesale** — settings-layer merging is per-field, and arrays are one field; per-entry catalog merging would need a keyed shape.
- **`tool_choice` is not mapped** — not part of the core vocabulary (MVP cut, shared with the pi-ai twin).
- **Requests use raw `fetch`, not `@cordisjs/plugin-http`** — no shared proxy/interception configuration; adoption is deferred until a second adapter wants it (`TODO(http)`).
- **Serialization flattens user and tool-result content to text blocks** — plugin-added block types are skipped, and empty tool output crosses the wire as the literal `(no output)`.
