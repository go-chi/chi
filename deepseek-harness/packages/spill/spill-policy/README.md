# @deepseek-ai/dsh-spill-policy

English | [中文](README.zh.md)

The **tool-result spill policy**: a `tools/post-execute` transformer that keeps oversized plain-text tool results out of the model's context. When a final result exceeds `maxInlineBytes`, it saves the FULL text through [`ctx.spillStore`](../spill) and replaces the model-facing result with a bounded head/tail preview plus the backend's locator and retrieval hint.

This plugin registers **no service** and owns no storage or preview mechanics: preview is [`@deepseek-ai/dsh-output-retention`](../../util/output-retention) (`TextRetainer`), storage is `ctx.spillStore`. It only decides WHEN to spill and composes the notice.

## Config

| Key | Default | Meaning |
|---|---|---|
| `maxInlineBytes` | *(omitted)* | Model-facing context cap for a plain-text result, in UTF-8 bytes (a non-negative integer; validated at load). **Omitted disables the policy entirely** (the plugin registers nothing). When set, a larger result is spilled and replaced with a preview derived from the same budget (head/tail split). |

## Behavior

1. Let the tool run (delegates via `next()`, so it bounds whatever a downstream hook accepted).
2. Skip nested executions (`exec.parent` is present — their DURABLE copy is bounded by the dispatch-log arm below), accepted value replacements (the registry must revalidate and rerender them), `read` (avoids a `read → spill → read again` loop), and any non-`accept` decision (a `block`'s corrective feedback passes through).
3. Flatten the accepted content only when it is **plain text** (all `text` blocks); a result with any non-text block is left untouched.
4. If its UTF-8 size is `≤ maxInlineBytes`, leave it unchanged.
5. Otherwise save the full text and replace the result with a preview + this notice, sized so the whole replacement (preview + blank line + notice) stays within `maxInlineBytes` — the notice's byte cost is reserved out of the budget, so the preview shrinks to fit and the model-facing result never exceeds the cap:

   ```text
   <retained head/tail preview>

   (Omitted N bytes. Full formatted result stored at: /…/session-…/…-web_fetch.txt. Use read with offset/limit, or grep this path to search within it.)
   ```

   When the notice alone fills the budget (a tiny cap or a long locator) the preview is empty and only the notice is returned. If even that notice-only replacement would exceed `maxInlineBytes`, the policy keeps the inline result — it never emits a replacement over the cap (and a within-cap replacement is always smaller than the original, so this also means spilling never adds bytes).

**Best-effort:** no session owner, no `ctx.spillStore` backend, or a `saveText` rejection ⇒ the policy logs a warning and returns the original result. A spill failure never turns a successful call into an `isError` or hides the inline result. A successful replacement changes only `content`; the canonical programmatic value is preserved.

**The dispatch-log arm:** a second listener on `tools/code-dispatch-log` applies the same cap, replacement pipeline, and best-effort fallbacks to the DURABLE copy of each `run_code` sub-call result (artifact label `dispatch`, keyed by the sub-call id). The program's value is untouched — it already crossed the worker boundary whole — and `read` sub-calls are bounded too: a log copy is not model context, so the read-again loop cannot occur, and `read` is precisely the tool that produces huge logs ([rationale](../../../.agents/notes/implemented/feature/2026-07-26-code-dispatch-log-spill.md)).

## Scope

The policy sees only the FINAL formatted model-facing result—not a tool's internal resource or canonical value. If a provider already truncated (e.g. `web-fetch-http.maxBodyChars`), the spill artifact holds the full formatted result the tool returned, not the full original source. Provider/resource caps stay mandatory and separate. `glob`/`grep` own item-level presentation spill because their complete acquired values still exist before rendering; bash streams own acquisition-time spill. The generic policy prepends its waterfall listener, then delegates, so ordinary tool-owned asynchronous projections complete before generic byte bounding regardless of plugin load order. See the [tool output spill Agent Note](../../../.agents/notes/implemented/architecture/2026-07-08-tool-output-spill-files.md).

## Model Experience

### Oversized plain-text result

#### What the model sees

Results at or below `maxInlineBytes`, nested results, `read` results, blocked decisions, and results containing non-text blocks are unchanged. An oversized plain-text model-facing result becomes a bounded head/tail preview followed by `(Omitted <bytes> bytes. Full formatted result stored at: <locator>. <retrievalHint>)`; storage or ownership failures leave the original result visible.

#### Token effect

A successful replacement is at most `maxInlineBytes` UTF-8 bytes and remains in history until compaction; the full spill text is not resent to the model.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **Only final plain-text results are spillable** — mixed-content results, blocked feedback, and `read` pass through; provider truncation or tool-owned retention that happened earlier cannot be recovered here.
- **A notice that cannot fit disables replacement for that call** — a tiny cap or long locator leaves the oversized original inline after the backend has already saved an unreferenced spill.
