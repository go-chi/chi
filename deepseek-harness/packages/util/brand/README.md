# dsh-brand

English | [中文](README.zh.md)

The `Branded<B>` nominal-typing primitive — a tiny, **type-only** package (no runtime code, no harness-package dependency) shared by every package that owns a cross-boundary id.

## What `Branded` is

A brand makes structurally-identical strings non-interchangeable at the type level: a `SessionId` cannot be passed where a `CallId` is expected, even though both are plain `string`s at runtime.

```ts
import type { Branded } from '@deepseek-ai/dsh-brand'

export type SessionId = Branded<'SessionId'>

/** Brand a string as a SessionId (a plain cast — zero runtime cost). */
export function SessionId(id: string): SessionId {
  return id as SessionId
}
```

Construction goes through the per-id factory in the owning package. Comparison, logging, JSON serialization, and the wire format behave as for an ordinary string; the brand is erased at compile time.

## Policy: brand ids that cross package boundaries

A package brands the ids it owns — `CallId` in `dsh-llm`, the shared agent/session `SessionId` in `dsh-session`, and `JobId` in `dsh-jobs`. Brand cross-package ids that could plausibly be confused; not every string needs one.

This package owns only the primitive. Keeping it dependency-free lets `dsh-jobs`, for example, brand `JobId` without importing an unrelated capability package merely to reach `Branded`.
