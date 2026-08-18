# @deepseek-ai/dsh-tool-web

English | [中文](README.zh.md)

The model-facing web tool suite — `web_search` and `web_fetch` — over the [web capability seam](../web/README.md) (`ctx.web`). It owns model-facing concerns only: tool names, JSON schemas, snake_case argument names, prompt sections, the result-count bound, result formatting, HTML→markdown presentation, and the UI presentation projection — `presentCall`, `presentResult` (a `card: 'web'` result card discriminated by `kind: 'search' | 'fetch'`), and the `output.presentationMeta` that carries the structured search sources or the fetch summary the lossy render text cannot (see the [web-result-card Agent Note](../../../.agents/notes/implemented/feature/2026-07-30-web-result-card.md)). All web access goes through `ctx.web`; this package never imports a concrete provider. Neither tool exposes a model-facing timeout — each tool's cooperative tool-call budget is declared here via config (`fetchTimeoutMs`/`searchTimeoutMs`, attached as `ToolDefinition.timeoutMs`) and enforced by [`@deepseek-ai/dsh-tool-call-timeout-policy`](../../guard/timeout-policy/README.md) (a `tools/execute` wrapper); each tool just forwards `exec.signal` to the seam.

Each tool is registered independently; a product that wants only one disables the other via config (`{ search: false }` / `{ fetch: false }`). Search guidance mentions `web_fetch` only when fetch is also config-enabled; a search-only composition instead tells the model to use returned snippets and cite their URLs.

## Tools

| Tool | Args | Behavior |
|---|---|---|
| `web_search` | `query` (string) | Discovery. Returns an optional answer plus source URLs. `max_results` is **not** model-facing — the tool sets the bound (the `searchMaxResults` config, default 8) and passes it to the seam. |
| `web_fetch` | `url` (string) | Retrieves a specific URL. HTML bodies are rendered to markdown (turndown with GFM tables/strikethrough); text bodies pass through. A non-2xx status is reported, not an error. The tool-call timeout is deployment policy (`dsh-tool-call-timeout-policy`), not a model argument. |

Both tools opt into concurrent scheduling because provider reads return content without mutating parent-agent state.

The normalized service results are also the canonical tool values: `WebSearchResult` and `WebFetchResult`. Native renderers preserve the answer/source and fetched-body text below; provider search/body caps remain acquisition limits rather than presentation-only truncation.

## Config

| Key | Default | Meaning |
|---|---|---|
| `search` | `true` | Register `web_search`. |
| `fetch` | `true` | Register `web_fetch`. |
| `searchMaxResults` | `8` | Upper bound on sources returned by one `web_search` call (the seam truncates a longer provider list and flags it). |
| `fetchTimeoutMs` | `30000` | Cooperative tool-call timeout budget (ms) for `web_fetch`. |
| `searchTimeoutMs` | `30000` | Cooperative tool-call timeout budget (ms) for `web_search`. |
| `fetchMaxOutputChars` | `200000` | Cap on source characters converted synchronously and on one complete `web_fetch` output (header, rendered body, and footer); a cut body gets the truncation notice when it fits. |

`fetchTimeoutMs`/`searchTimeoutMs` declare each tool's cooperative timeout budget (attached as `ToolDefinition.timeoutMs`), enforced by [`@deepseek-ai/dsh-tool-call-timeout-policy`](../../guard/timeout-policy/README.md); the model-facing schema exposes no timeout argument. `fetchMaxOutputChars` bounds both synchronous conversion work and the complete rendered result: only that many source characters are converted, and the header, converted prefix, and truncation notice are then capped together. The default leaves headroom above the local provider's 100,000-character body cap, but rendered expansion can still make the final bound truncate the result.

```yaml
- id: tool-web
  name: '@deepseek-ai/dsh-tool-web'
```

## Stable registration

Tool registration follows product **enablement**, not backend availability. A tool stays visible even when its selected provider is missing, misconfigured, ambiguous, or temporarily unavailable; the seam resolves the provider at execution time and execution fails with a structured `WebError` (e.g. `WEB_PROVIDER_UNAVAILABLE`, `WEB_PROVIDER_AMBIGUOUS`), which `ToolRuntime.execute()` turns into an error tool result the model can read and hooks/UI can route on. This keeps the model schema stable without making plugin load order, credential state, or HMR timing part of the model-facing contract. To remove a web tool entirely, disable it here in config.

The tool never calls a provider's `available()` and never enumerates providers — its only execution path is `ctx.web.search()` / `ctx.web.fetch()`, and provider unavailability reaches it as the structured `WebError` codes selection throws at execution time. Provider selection stays entirely inside the seam, with one owner.

## Model Experience

### System prompt

#### What the model sees

Search and fetch contribute the web-search and web-fetch guidance below. Search chooses its fetch-enabled or search-only text from config at registration time. A scoped tool restriction does not remove these independently registered sections.

##### Web search guidance with fetch enabled

```markdown
Use the web_search tool to discover current information on the web. It returns an optional answer plus a list of source URLs. Follow up with web_fetch when you need the full content of a specific result, and cite the relevant URLs as markdown links.
```

##### Web search-only guidance

```markdown
Use the web_search tool to discover current information on the web. It returns an optional answer plus a list of source URLs. Use the returned source snippets when available, and cite the relevant URLs as markdown links.
```

##### Web fetch guidance

```markdown
Use the web_fetch tool to retrieve the content of a specific HTTP(S) URL (for example a result from web_search). It returns the page content decoded to text. Cite the URL as a markdown link when you use its content.
```

#### Token effect

Fixed guidance cost per request for each config-enabled tool, even when a restriction hides its schema. Toggling fetch changes the search guidance as well as registering or removing the fetch section.

#### KV Cache effect

Prefix-stable while enabled tools, scope, and guidance text are unchanged. Config enablement—including toggling fetch's search-guidance branch—or plugin lifecycle may invalidate reuse from the first changed prompt section; scoped schema restrictions do not remove it.

### Tool schemas

#### What the model sees

The model sees the generated [`web_search` and `web_fetch` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-web). Result-count and timeout budgets are deployment settings, not model arguments.

#### Token effect

Fixed schema cost per request; config disablement removes both schema and guidance, while a scoped restriction removes only the schema.

#### KV Cache effect

Prefix-stable while definitions and visibility are unchanged. Config enablement, plugin lifecycle, or scoped restrictions may invalidate reuse from the first changed schema token.

### Search result

#### What the model sees

The optional provider-owned answer is followed by `Sources:` and data-dependent lines shaped exactly `- [<title-or-url>](<url>)`, optionally suffixed ` — <snippet> (<publishedAt>)`. With neither answer nor sources the result says `No results found.` A capped list adds `(Showing the first <count> sources. Refine the query for more.)`; every result ends `Cite the relevant URLs above as markdown links in your answer.`

#### Token effect

Data-dependent results are resent until compaction and sources are capped by `searchMaxResults`.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Fetch result

#### What the model sees

A successful fetch is exactly `Fetched <finalUrl> (HTTP <statusCode>)`, a blank line, and the provider-owned decoded body. Truncation adds a blank line and `(Content truncated. Fetch a more specific URL or section for the full text.)`; failures become `Error: <message>`. Queries and URLs remain in call history.

#### Token effect

Provider caps bound body size; retained call arguments and results are resent until compaction, and timeout policy can replace a late result with a short error.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Argument errors

#### What the model sees

Blank inputs become exactly `Error: query must be a non-empty string` or `Error: url must be a non-empty string`.

#### Token effect

Only the failing call adds these retained tokens.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **HTML→markdown conversion degrades on inputs GFM cannot safely represent** — [turndown](https://github.com/mixmark-io/turndown) (with GFM tables/strikethrough) converts at most `fetchMaxOutputChars` source characters through a real DOM. A conservative 512-level lexical guard passes deeply or ambiguously nested bodies through as raw HTML, conversion exceptions do the same, and table `colspan` is ignored because GFM has no spanning-cell representation; these bounds avoid blocking the event loop or expanding output from an untrusted numeric attribute ([archived dependency decision](../../../.agents/notes/archived/simplification/2026-07-26-turndown-for-tool-web-html-markdown.md)).
- **The model-facing API is minimal by design, with promotions deferred** — `max_results` stays a config bound (not a model argument), and `web_fetch` takes only `url` (no `format`/`prompt`/LLM-summarization mode); both are named later steps in [the seam Agent Note](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md).
- **No web-specific permission policy** — both tools execute without requesting `ctx.approval`; a deployment that needs confirmation must add a `tools/pre-execute` policy, and the package does not define persistent URL/domain grants.
