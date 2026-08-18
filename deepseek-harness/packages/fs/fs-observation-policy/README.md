# @deepseek-ai/dsh-fs-observation-policy

English | [中文](README.zh.md)

The **fs-observation-policy plugin**: it records observed presence or absence and adds read-before-edit plus guarded write/edit on top of the `ctx.fs` provider contract ([`@deepseek-ai/dsh-fs`](../fs)) — through the `fs/*` event gate, **NOT** through a method service. This plugin registers **no** `ctx.fsPolicy` service and has no public `read`/`write`/`edit`/`resolve` methods. It is the policy third of the filesystem stack: not a swappable seam, but the policy that does not belong on the `FileSystem` provider base class.

```ts
import type { Context } from '@deepseek-ai/cordis'
import * as FsPolicy from '@deepseek-ai/dsh-fs-observation-policy'

declare const ctx: Context

// No service to inject — this plugin only registers the three fs/* listeners.
// Load it alongside a ctx.fs provider (e.g. @deepseek-ai/dsh-fs-local) and the
// @deepseek-ai/dsh-tool-fs tools; the tools dispatch the fs/* events this plugin
// decides. Order does not matter for resolution (no inject), but the policy
// listener should be the first decider registered for the fs/*-intent slots.
await ctx.plugin(FsPolicy)
```

## The four-layer split

| Layer | Package | Role |
|---|---|---|
| tool / executor | `@deepseek-ai/dsh-tool-fs` | model-facing schemas + read windowing + text rendering; reads/writes/edits via `ctx.fs`, dispatches the `fs/*` events |
| policy | `@deepseek-ai/dsh-fs-observation-policy` (this) | observed-state + read-before-edit + version-guarded write/edit, contributed through the `fs/*` event gate (no service) |
| provider contract | `@deepseek-ai/dsh-fs` | `ctx.fs`: text IO + atomic mutation primitives (optional version guard); owns the `fs/*` event vocabulary |
| provider | `@deepseek-ai/dsh-fs-local` | local implementation of `ctx.fs` |

## How the gate participates

Three `fs/*` events (declared by `@deepseek-ai/dsh-fs`, dispatched by `@deepseek-ai/dsh-tool-fs`):

| Event | This plugin's listener |
|---|---|
| `fs/write-intent` | Unseen or observed absent → `{ kind: 'createIfAbsent' }`; observed present → `{ kind: 'replaceIfVersion', version: vObserved }`. Single-slot decision; does NOT call `next()`. |
| `fs/edit-intent` | Unseen → `FS_NOT_OBSERVED`; observed absent → `FS_NOT_FOUND`; observed present → `{ version: vObserved }` as the CAS basis. Single-slot decision; does NOT call `next()`. |
| `fs/observed` | Records `{ kind: 'present', version }` or `{ kind: 'absent' }` for this owner+target. Synchronous, side-effect-only `WeakMap.set`. |

## Observed state is the prior-observation record; freshness is provider CAS

Observed state is a weak owner-to-target map with three logical states: unseen, confirmed absent, or present at a version. A successful file read or mutation records presence; a metadata miss from `read` or the `str_replace_editor` `view`, `str_replace`, or `insert` command records absence before returning `FS_NOT_FOUND`. The plugin performs no filesystem I/O: it converts that state into a provider guard. Presence supplies the observed version, while absence lets only a `createIfAbsent` write proceed; edit has no version basis and returns `FS_NOT_FOUND`. A windowed read observes the whole file version, so a later targeted edit is allowed only while that file remains unchanged. State is discarded on plugin disposal and is not persisted across sessions.

## Single-slot, first-wins

The `fs/write-intent`/`fs/edit-intent` slots hold exactly one decider — this plugin fully decides and does not call `next()`. The slot is first-wins by registration order; this plugin owning it is the default-deployment convention, not an event-enforced invariant (a decider registered before / `prepend`ed would win instead). This is not a composable authorization chain — layered permission/audit/sandbox interception belongs on `tools/execute`.

## No method coupling

Because the plugin influences the world only through events, removing it does not break `@deepseek-ai/dsh-tool-fs` at a service-injection boundary: the tool falls through to the bare `ctx.fs` provider (unconditional write/edit, no observed-state). Loading it back layers the policy on. That graceful add/remove is the whole point of the event gate over a mandatory method service.

## Model Experience

### Filesystem tool outcome

#### What the model sees

This plugin adds no prompt or schema. It rejects an edit without a prior observation with code `FS_NOT_OBSERVED` and exact message `edit requires reading "<path>" first`; editing a target just observed absent returns `FS_NOT_FOUND`. Guarded mutations whose positive observation is stale propagate the provider-owned `FS_STALE_VERSION` error. [`dsh-tool-fs`](../tool-fs/README.md) owns the model-facing error wrapper, which appends the recovery instruction to `FS_STALE_VERSION` (`— re-read the file, then retry`) and `FS_NOT_OBSERVED` (`— read the file, then retry`) messages while preserving the code. Following the stale remedy on an externally deleted target now records absence: the next guarded write may recreate it with `createIfAbsent`, while the provider atomically preserves any concurrent creator.

#### Token effect

Zero tokens on allowed operations beyond the ordinary tool result. A denial adds the small retained error result and avoids any success payload.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **Observed state does not survive a session resume** — persistence of the `WeakMap` record is deferred, so a resumed session must re-read files before guarded writes/edits.
- **Actors without an agent session can never satisfy the policy** — their edits throw `FS_NOT_OBSERVED` and their writes always resolve `createIfAbsent`, so a non-agent caller cannot overwrite an existing file through the gate.
- **Direct `ctx.fs` reads emit no `fs/observed`** — a file read outside the `read` tool stays unobserved, and a later guarded edit rejects with `FS_NOT_OBSERVED` until the tool reads it.
- **Authorization is version freshness, not view completeness** — any windowed read authorizes a full-file overwrite of an unchanged file, deliberately weaker than a full-view rule ([seam-split Agent Note](../../../.agents/notes/implemented/simplification/2026-06-26-fsspec-style-fs-seam.md)).
