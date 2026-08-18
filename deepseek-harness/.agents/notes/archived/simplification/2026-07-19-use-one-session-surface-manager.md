# Agent Note: Use one surface manager per session

Status: implemented
Archived: 2026-07-26

English | [中文](2026-07-19-use-one-session-surface-manager.zh.md)

## Problem

`Session` maintained two `SurfaceManager` instances over the same append-only event log. One validated seed and append candidates, while a second lazy instance independently folded committed events for `session.surface`, derived messages, compaction, and workspace context. Once the public surface had been read, every later event advanced duplicate node and replacement-generation state without creating a separate authority or failure boundary.

## Decision

Each `Session` owns one eagerly constructed `SurfaceManager`. Seed and append acceptance call `validateNext()` on that manager before committing an event, and `session.surface` returns the same object through this readonly contract:

```ts
export interface SessionSurface {
  readonly nodes: readonly number[]
  readonly replaceGeneration: number
}
```

Candidate validation remains atomic. `validateNext()` may synchronize committed log entries, but it only plans the uncommitted candidate. The candidate enters manager state after `log.push()` and the next delta synchronization, so surface validation failures and pre-commit `internal/dispatch` vetoes leave no phantom node or replacement generation.

`foldSurface()` remains the detached full-log replay function for offline validation and reconstruction. It uses the same transitions and agrees with the live manager for every committed prefix without sharing mutable state.

## Alternatives considered

**Keep acceptance and projection state separate.** Separate instances appeared to isolate public reads from validation, but callers already receive borrowed surface state and the declared readonly contract prevents ordinary mutation. Duplicating the manager was not a runtime trust boundary.

**Recompute the public surface from the full log on every access.** This removed duplicate cached state but gave up incremental derivation and made repeated request construction scale with complete session history.

## Consequences

- Acceptance, `session.surface`, derived messages, compaction, and workspace context observe one incremental state.
- `Session.surface` exposes no validation method, while its object identity and borrowed readonly node array remain stable.
- A hostile cast can still corrupt borrowed state; JavaScript callers that deliberately bypass the readonly contract remain outside the supported same-process boundary.
- Surface, seed, dispatch-veto, request-reconstruction, compaction, and workspace-context tests exercise the shared manager and detached replay paths.
