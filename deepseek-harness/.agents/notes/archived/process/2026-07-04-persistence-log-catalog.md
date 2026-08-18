# Agent Note: Generated persistence log event catalog

Status: implemented
Archived: 2026-07-27

English | [中文](2026-07-04-persistence-log-catalog.zh.md)

## Problem

`SessionEventMap` is the on-disk vocabulary, but its declarations are split across the owning session package and declaration merges. The generated persistence catalog is the single reference for every event, its complete payload declaration and source JSDoc, and the shared `SessionEvent` envelope; hand-maintained tables drift and are removed. These records are not Cordis events—observers receive them through the single `session/event` bus event—so the Cordis catalog cannot cover them. The generator discovers all declarations and the doc-sync freshness gate rejects omissions or stale output.

## Decision

Generate `docs/persistence-catalog.md` from source, with a freshness gate, as the fourth reference surface: the *records* a persisted session log can contain, complementing the cordis catalog (wiring), core-data-structures (vocabulary), and the tool catalog (tools).

`gen-persistence-catalog.ts` scans every owning and declaration-merged `SessionEventMap` with the TypeScript AST. It renders each member from its leading JSDoc through the complete payload type, retaining nested property comments and removing only its containing indentation, and also pastes the owning `SessionEventType`, `SurfaceEventType`, `SurfaceOp`, and `SessionEvent` declarations that compose the persisted envelope. Derived surface badges, reference links, and source locations remain outside the declaration blocks. The doc-sync freshness check rejects a vocabulary or envelope change whose catalog was not regenerated.

Specific choices:

- **JSDoc completeness, enforced.** Every member and rendered envelope type must carry description prose, and the full source JSDoc stays attached to its declaration in the catalog. An `@mode` tag is a hard error: dispatch modes belong to cordis bus events, and persisted records have none. Violations aggregate into one error listing every offender.
- **The surface badge is derived, not hand-listed.** `SurfaceEventType` — the subset that produces LLM messages and may carry `surfaceOp` — is parsed from its union declaration in the owning package; a union member naming no declared event is a hard error (a stale union member would otherwise silently badge nothing). Everything else renders **log-only**.
- **A dedicated fence.** Declaration blocks use a ` ```ts persistence-catalog ` info string that `doc-typecheck` recognizes and skips, excluded from the opt-out ratio — the same treatment as `ts cordis-catalog` (the declarations reference types from their owning modules and are not standalone-compilable).
- **Repo scope.** The catalog enumerates the packages in this repo, matching the siblings' packages-only scope; a downstream plugin can merge further event types, which are outside the catalog by construction. The walk defends its own assumptions with hard errors: the owning top-level `interface SessionEventMap` must be the single exported declaration in `@deepseek-ai/dsh-session` (an unrelated, local, or duplicate same-named interface cannot be catalogued as the on-disk vocabulary), no declaration may carry `extends` (inherited keys would join `keyof SessionEventMap` without a catalog row), every member must be a property signature with an explicit payload type (a method-form member would join `keyof` yet slip past a silent walk), and a duplicate member across declarations fails.

This supersedes the hand-copies: the session.md `hook/*` table, the compact README's event table, the hook-protocol README's payload bullets, and the session README's name-list now link the catalog instead of restating payloads (the surrounding semantics prose stays where it was). The two stray `@mode emit` tags on the hook-protocol merge members are removed — the new gate rejects them as the category error they were.

## Alternatives considered

- **A boot-based generator, like the tool catalog's** — the log vocabulary is fully static, so the AST pass reads the whole truth without booting anything.
- **Keeping the hand-copies** — a hand-copy only checks the names someone already wrote down; the session README's merge note had already drifted when the catalog landed.

## Consequences

- The catalog cannot drift: a vocabulary or envelope change the committed file doesn't reflect fails `verify-persistence-catalog` in `doc-sync` and CI, and a new merged event with no JSDoc fails the generator outright — a plugin can no longer add an undocumented on-disk record type.
- Event prose has a single home, the JSDoc at the declaration; the catalog preserves that JSDoc and any nested field comments without flattening or paraphrasing them.
- The `SurfaceEventType` union is now structurally load-bearing for docs: renaming an event without updating the union (or vice versa) fails the generator, not just the compiler.
- The badge derivation assumes the union stays a closed set of string literals with exactly one owner; a refactor away from that shape must update the generator in the same change.
