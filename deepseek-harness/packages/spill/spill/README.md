# @deepseek-ai/dsh-spill

English | [中文](README.zh.md)

The **`SpillStore`** (`ctx.spillStore`) defines WHAT a spill backend does — persist a tool's oversized text and return a model-facing locator plus retrieval guidance — without saying HOW.

This package is one third of the spill capability, split so each concern evolves (and swaps) independently:

| Package | Role |
|---|---|
| `@deepseek-ai/dsh-spill` (this) | Service Definition: abstract service + vocabulary types |
| `@deepseek-ai/dsh-spill-local` | Service Provider: private session-scoped files on the host filesystem |
| `@deepseek-ai/dsh-spill-policy` | Consumer: the tool-result policy that spills oversized final results |

The split mirrors the shell/fs seams. A future remote or virtual backend (e.g. a `spill://…` URI, a database key, or a backend-specific retrieval tool) implements this Service Definition without touching the policy plugin.

## Service API (`ctx.spillStore`)

| Member | Semantics |
|---|---|
| `saveText(input)` | Persist `input.content` verbatim; resolves with a `SpillRef` (opaque locator, exact bytes written, and retrieval hint). **Rejects on a real storage failure** (permissions, ENOSPC, backend unavailable) — the caller decides how to degrade. |

Storage is grouped by the request's `owner` session as a save-time namespace; the backend chooses its own private representation and may derive names from — never trust as a path — the caller's `suggestedName`. The seam owns storage only: NO retention policy (that is [`@deepseek-ai/dsh-output-retention`](../../util/output-retention)), NO tool-result replacement (that is `@deepseek-ai/dsh-spill-policy`), NO retrieval/search API (the backend's `retrievalHint` tells the model what to do with the locator).

## Vocabulary

`SaveTextSpill` (owner, source, suggestedName, content) is the request; `SpillRef` (locator, bytes, retrievalHint) is the result. `SpillLocator` is [branded](../../util/brand) and rendered to the model as an opaque string — a local path for `dsh-spill-local`, but a future backend may return a URI, key, or command token without changing policy/tool consumers. `SpillOwner.sessionId` is the save-time storage namespace: forked sessions inherit existing locators from the seeded log without copying or re-owning them, and new spills after the fork use the child session id. `SpillSource` records the producing `toolName`, `callId`, and `label` for backend naming and inspection, not access control. See `src/types.ts` for the full contracts.

See the [tool output spill Agent Note](../../../.agents/notes/implemented/architecture/2026-07-08-tool-output-spill-files.md) for the design rationale, including why creation belongs to the runtime spill seam rather than the model-facing `write` tool.

## Model Experience

Indirectly, through spill consumers that render a backend locator and retrieval guidance.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **The seam has no retrieval or deletion API** — consumers can only render the backend's locator and guidance; lifecycle and access semantics remain backend-specific.
- **Storage is not access control** — `SpillOwner` namespaces writes but does not authorize reads of a locator; each backend and retrieval consumer must enforce its own boundary.
