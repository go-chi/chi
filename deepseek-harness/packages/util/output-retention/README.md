# dsh-output-retention

English | [中文](README.zh.md)

A dependency-light **retention** library: bounded model-facing output for tools that must cap how much context they return. A caller feeds items or text chunks into a bounded object, then gets the retained content plus exact omission metadata.

The library owns **only** the mechanical question *"what did we keep, and what did we omit?"*. Tool-specific code keeps its business semantics: file grouping, line numbering, exit codes, provider error states, per-line preview truncation, spill files, and the model-facing prose. This is the boundary the [Agent Note](../../../.agents/notes/implemented/architecture/2026-07-06-tool-result-retention-library.md) draws.

It is a **library, not a service or plugin**: no `ctx`, registers nothing, emits no events. The only state is per-retainer (one accumulation), never cross-call. Tool packages import it directly.

## API

```ts
import {
  ItemRetainer, TextRetainer,
  describeOmitted, formatRetentionNotice,
} from '@deepseek-ai/dsh-output-retention'
import type {
  Omitted, PushDecision, RetainedItems, RetainedText,
  ItemRetentionStrategy, TextRetentionStrategy, RetentionNotice,
} from '@deepseek-ai/dsh-output-retention'
```

| Export | Role |
|---|---|
| `ItemRetainer<T>` | Bounds ordered logical units (paths, grep matches, sources). `head` only. `push()` → `PushDecision`; `finish()` → `RetainedItems<T>`. |
| `TextRetainer` | Bounds a byte-oriented text stream. `head` / `tail` / `headTail`, UTF-8 boundaries preserved at `finish()`. `push()` → `PushDecision`; `finish()` → `RetainedText`. |
| `describeOmitted(omitted, unit)` | Standardized omission clause (`exact` prints a count; `unknown` does not). |
| `formatRetentionNotice(notice, recovery)` | Joins the standardized omission clause with the tool's own recovery guidance. |
| `Omitted` | `none` / `exact` / `unknown` — how much was omitted. |
| `PushDecision` | `{ kept, truncated }` — the per-push retention result. |

## Resource Modes

The two retainers are separate names, not one generic collector, because they differ in **resource model**.

- **`ItemRetainer` bounds ordered logical units.** A search tool can collect a full result set for spill-file recovery while retaining only the first `maxItems` for the model-facing preview. The omission count is exact because the caller keeps feeding every observed item.
- **`TextRetainer` bounds byte-oriented text.** `head`, `tail`, and `headTail` preserve UTF-8 boundaries at `finish()`; `headTail` is the shape `dsh-spill-policy` uses to build a bounded preview around a spill-file notice.

## `truncated` is a budget fact, never "incomplete"

`truncated` means *the retainer omitted otherwise-available content because of a budget*. It does **not** mean the upstream was incomplete. Permission failures, skipped binary files, provider partial failures, unreadable candidates, and invalid UTF-8 stay in tool-domain fields — never folded into `truncated`. Conflating the two is the bug this library's naming most invites; keep them separate.

## Bytes, not characters

Text caps and `omittedBytes` count **bytes**, for process/body safety (a child's pipe and an HTTP body are byte streams). A chunk that straddles a codepoint is handled: `finish()` trims a partial codepoint at each cut so the returned text never introduces a replacement char at the boundary, and the two sides are decoded separately so a codepoint is never reconstructed across the omitted middle. Character- or line-level preview budgets are a separate, tool-owned concern.

## Tool mappings

Current retention consumers use these mappings:

| Tool | Retainer & strategy | Notes |
|---|---|---|
| `glob` | `ItemRetainer<FsGlobEntry>`, `head` | Collect the full sorted path list for a spill file while retaining the first page inline. Path mapping, skipped candidates, and `incomplete` stay outside. |
| `grep` | `ItemRetainer<FlatGrepMatch>`, `head` | Collect matches for a spill file while retaining the first page inline. Per-match preview truncation, grouping, sorting, and `incomplete` stay outside. |
| `bash` | `TextRetainer`, `tail` or `headTail` | Executor still owns spill files, exit status, signal, timeout, and background jobs. |
| `web_fetch` | `TextRetainer`, `head` or `headTail` | Provider/resource caps stay provider facts; the retainer supplies only retained text and omission metadata. |
| `web_search` | `ItemRetainer<WebSearchSource>`, `head` | Standardizes the "sources capped" notice when providers return more sources than the model-facing result should include. |

`read` remains outside this generic library. Its `read-render` helper owns a file-specific pagination contract — `offset`/`limit`, line numbers, `totalLines`, offset-out-of-range errors, per-line preview truncation, and a byte cap over the selected window — which is a line-window renderer. A single `Omitted` count cannot represent both sides of that window.

## Usage shape

```ts ignore-check
// glob: keep the first page inline while still collecting the full list for spill.
const retainer = new ItemRetainer<FsGlobEntry>({ kind: 'head', maxItems: globMaxResults })
const allEntries: FsGlobEntry[] = []
for await (const entry of candidates) {
  allEntries.push(entry)
  retainer.push(entry)
}
const { items, truncated, omitted } = retainer.finish()

// bash: keep a head + tail, read to process exit.
const out = new TextRetainer({ kind: 'headTail', headBytes: headCap, tailBytes: tailCap })
child.stdout.on('data', (chunk: Buffer) => { out.push(chunk) })
const { text, omittedBytes } = out.finish()

// A footer: the library standardizes the omission clause; the tool owns recovery words.
const footer = formatRetentionNotice(
  { scope: 'grep', strategy: 'head', unit: 'items', limit: grepMaxMatches, kept: items.length, omitted },
  ({ kept }) => `Results capped at ${kept}. Narrow the pattern, path, or include to see more.`,
)
```

## Model Experience

Indirectly, through tool consumers that render retained content and omission metadata.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **Item retention supports `head` only** — tail, head/tail, pagination, grouping, and provider-completeness semantics remain tool-owned.
- **Text retention is byte-oriented** — line and character windows such as `read` pagination require a separate renderer, and a cut may discard partial UTF-8 boundary bytes to keep returned text valid.
