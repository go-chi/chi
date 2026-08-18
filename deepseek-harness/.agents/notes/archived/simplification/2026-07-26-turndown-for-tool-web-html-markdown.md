# Agent Note: Replace tool-web's regex HTML-to-markdown converter with turndown

Status: implemented
Archived: 2026-08-07

English | [中文](2026-07-26-turndown-for-tool-web-html-markdown.zh.md)

## Problem

`dsh-tool-web`'s `src/html.ts` (~86 lines, ~40 lines of dedicated tests; deleted by this change) converted fetched HTML to markdown with regexes: strip script/style/noscript/comments, convert `<a>`/`<h1-6>`/`<li>`, decode numeric entities plus a 12-entry named-entity table, collapse whitespace. The module's own JSDoc said "A richer converter can replace it without changing the seam or tool schema", and the README's Known Limitations documented it as "a minimal regex converter, not an HTML parser — tables, images, and nested formatting are lost." The [web capability seam note](../architecture/2026-06-24-web-capability-seam.md) assigns HTML→markdown to this package as presentation, so the swap point was exactly here. The converter's output is model-visible on every fetched HTML page; no keyless snapshot exercised `web_fetch`, so no expected outputs pinned it.

## Decision

`packages/web/tool-web/src/fetch.ts` owns a module-level [`turndown`](https://github.com/mixmark-io/turndown) instance (`headingStyle: 'atx'`, `codeBlockStyle: 'fenced'`, `bulletListMarker: '-'` — fixed model-facing presentation, not deployment tunables) with `@joplin/turndown-plugin-gfm`'s composite `gfm` plugin for tables/strikethrough and `remove(['script', 'style', 'noscript'])` replacing the old wholesale drops. `formatFetchOutput` limits both the source prefix converted synchronously and the complete rendered output with `fetchMaxOutputChars` (default 200,000), so a custom provider cannot make conversion work unbounded before the output cap applies. The HTML arm then guards conversion twice: a conservative linear lexical pass treats comment contents conservatively, skips raw-text bodies, honors quoted tag text, and passes a body through raw when its stack crosses 512 levels; a try/catch also falls back to raw HTML when turndown rejects markup the guard cannot model. The GFM cell rule is overridden to ignore `colspan`, which Markdown cannot represent, rather than letting an untrusted numeric attribute synthesize arbitrary empty cells. `html.ts` and its conversion tests are deleted; the source/output bounds, fallback, and status-header/truncation-footer formatting are tested in `tests/tool-web.spec.ts`, and the README's Known Limitations trades the regex-converter caveat for the bounded degradation cases. The gfm plugin ships no types; `src/turndown-plugin-gfm.d.ts` declares the one imported export over `@types/turndown` (a devDependency).

The dependency-weight question the proposal flagged resolves in favor of the swap: `@deepseek-ai/dsh-tool-web` is in the single-file-executable closure ([single-exe note](../architecture/2026-07-10-single-file-executable-sdk-runtime-distribution.md)), and the exe's asset globs would pack ~7.9 MB of the three packages as published — but ~6 MB of that is `@mixmark-io/domino`'s test corpus (`test/**`), with runtime `lib/` at ~550 KB against a ~174 MB artifact, under 0.5% either way.

## Snapshot coverage

The previously-missing keyless `web_fetch` snapshot ships with the change as the acp-agent scenario `web-fetch`: `examples/acp-agent/web.cordis.yml` composes the web seam, the real `dsh-web-fetch-local` provider, `tool-web` with `search: false`, and `web-fetch-fixture-server.mjs` — a loopback HTTP fixture on a fixed port (the fetched URL is part of the recorded transcript) serving deterministic HTML with named entities, a GFM table, and nested formatting. Recording and keyless replay both drive the real HTTP fetch and conversion; the pinned tool result is the turndown output, and the scenario pins the `web` header class (the `web_fetch` schema and guidance).

## Alternatives considered

- **`@mozilla/readability` + a DOM.** Solves a different problem (content extraction, not conversion) and drags a heavier DOM dependency; the seam only asks for markdown rendering of whatever the fetch returned.
- **Keep the regex converter.** It was an explicit v1 placeholder per its own JSDoc; keeping it meant model-visible quality (tables, images, nested formatting) stayed lost for the cost of maintaining bespoke entity tables.
- **The minimal `entities`-only variant.** The proposal's fallback position: replace only the entity-decoding third of `html.ts` with the zero-dependency `entities` package, deleting less but avoiding the dependency-weight question. Not taken because the closure math above made the weight immaterial while the full swap deletes the whole hand-rolled converter and its documented quality gaps.
- **`turndown-plugin-gfm` (the original) instead of `@joplin/turndown-plugin-gfm`.** The original is unmaintained (last publish 2018); the Joplin fork is current against turndown 7 and actively released.

## Consequences

- **Bought**: standards-based model-visible markdown — ordinary tables, images, strikethrough, nested emphasis, fenced code blocks, and the complete named-entity set — plus the deletion of the bespoke converter and its entity tables.
- **Paid**: two runtime dependencies (`turndown` → `@mixmark-io/domino`) enter tool-web and therefore the exe closure (~550 KB of runtime code as measured above); overlong input is converted only through a bounded prefix, pathological nesting falls back to raw HTML, and spanning table cells are flattened because GFM has no corresponding syntax.
- Model-visible output changed on every fetched HTML page; nothing pinned the old output, and the new snapshot pins the new one.

## Testing

- `packages/web/tool-web/tests/tool-web.spec.ts` covers the turndown conversion surface (entities, links, tables, nesting, script/style/noscript removal), ignored table spans, source-prefix and complete-output bounds, fast raw-HTML passthrough for deep or deceptively closed nesting, linear handling of malformed tags, the residual converter-throw fallback, and exact and tiny output budgets; per-file coverage on the package src is 100%.
- The `web-fetch` acp-agent snapshot pins the assembled behavior keylessly end to end (real Loader composition, real HTTP fetch, real conversion).
