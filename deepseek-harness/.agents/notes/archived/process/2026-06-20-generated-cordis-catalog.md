# Agent Note: Generated cordis events + services catalog

Status: implemented
Archived: 2026-08-07

English | [中文](2026-06-20-generated-cordis-catalog.zh.md)

## Problem

A plugin author needs two reference surfaces that no single document gave them: every cordis **event** they can listen to (with its exact signature and dispatch mode) and every `ctx.<key>` **service** they can call (with its exact interface). The pieces existed but were scattered — a hand-maintained event-taxonomy *table* in `docs/architecture.md` (names + prose Mode/Purpose, name-set-checked by `verify-event-taxonomy`), a Service-map table (8 rows of role prose), and the `interface Events` / `interface Context` declarations themselves. The taxonomy table also could not catch a brand-new *undocumented* event: a name-set verifier only checks the names that are already in the table on both sides.

This is the wiring-axis complement to the [core-data-structures catalog](../../../../docs/core-data-structures/core.md) ([its Agent Note](2026-06-20-core-data-structures-catalog.md)): that one catalogs the *data structures* the loop moves around (verified hand-pastes); this one catalogs the *events and services* that move them.

## Decision

Generate the catalog from source instead of hand-maintaining a table and verifying a subset.

`scripts/gen-cordis-catalog.ts` uses the TypeScript compiler API to emit separate event and service references from declarations and source JSDoc. Events include dispatch modes and their original member JSDoc; services include public signatures with each method's original JSDoc. Deterministic `--write` and `--check` modes make both pages generated artifacts, with freshness enforced by `doc-sync`.

Pure generation is correct here because the codebase is disciplined enough that the AST is the whole truth: every event/service name is a string literal that round-trips to a static declaration — there are no dynamically-named events and no runtime-only services. So a generated doc cannot be wrong, and it closes the undocumented-event gap structurally (generation enumerates source rather than checking a hand-written subset).

Specific choices:

- **`@mode` tag, cross-checked.** Each harness event's JSDoc carries an explicit `@mode emit|waterfall|parallel|serial` tag; the generator hard-errors on a missing tag. Where the signature shape is conclusive — a trailing `next: () => …` parameter is structurally a waterfall — it asserts the tag agrees and hard-errors on a contradiction. The emit/parallel/serial distinction is not structurally visible (`session/flush` returns `Promise<void> | void` with no `next`, as does the ordered `agent/pre-step` checkpoint), so it is trusted from the tag. The authoring rule lives in [AGENTS.md](../../../../AGENTS.md).
- **Tiered scope.** The harness tier (the 8 `@deepseek-ai/dsh-*` services + their events) is rendered in full from source. The inherited tier (cordis-core `ctx.on/emit/effect/provide/…` + the `internal/*` events + loader/hmr/timer) is pinned vendor source a plugin also sees; it is rendered tersely (name + one-line + source pointer) from a curated table in the generator, NOT walked from the vendor AST — the cordis-core `Context` mixes true ctx members with non-service fields (`root`, `baseUrl`, `logger`), and the vendor surface changes only on a deliberate vendor sync.
- **Cross-links to the data-structure catalog.** Every repository-owned type name in a signature (`GenerateOptions`, `StreamChunk`, `ToolDefinition`, …) links to its primary core-data-structures page through a curated map. The AST walk is fail-closed: each parameter, generic constraint/default, and return-type reference must be mapped, be the signature's own type parameter, be a named TypeScript/Cordis foundation type, or carry a named exception with its non-catalog documentation owner. Violations aggregate with source pointers and name the appropriate owning lists. The map does NOT reuse `type-equiv.manifest.json`, which documents `…Map` symbols while signatures reference derived union names and lists some symbols on multiple pages.
- **A dedicated fence.** Signature blocks use a ` ```ts cordis-catalog ` info string and place the original event or public-method JSDoc immediately before its declaration. `doc-typecheck` recognizes and skips the bare fragments, excluding them from the opt-out ratio — the same treatment `type-equiv` blocks get.

This **supersedes the event-taxonomy half** of [doc-sync enforcement](../../archived/process/2026-06-11-doc-sync-enforcement.md): `verify-event-taxonomy` and its `docs/architecture.md` table are retired (the architecture.md heading stays, its body now points at the catalog; the Service-map role table stays as curated prose). doc-typecheck, verify-md-wrap, verify-md-links, and verify-type-equiv are unchanged.

## Alternatives considered

- **Verify-don't-generate, as the retired taxonomy check did** — reversed *for this surface only*: the data here is mechanically complete, so generation is strictly stronger (full signatures, cannot drift, catches undocumented events) than a name-set check of a hand-maintained table.
- **Walking the vendor AST for the inherited tier** — rejected for the curated table: the cordis-core `Context` mixes true ctx members with non-service fields, and the pinned vendor surface changes only on a deliberate sync.
- **Reusing `type-equiv.manifest.json` as the signature cross-link map** — rejected for a complete curated const plus fail-closed coverage: the manifest documents `…Map` symbols while signatures reference derived union names, and it lists some symbols on multiple pages. The explicit map makes each rendered destination and each non-catalog exception a reviewable decision.

## Consequences

- The catalog cannot drift: a source change that the committed file doesn't reflect fails `verify-cordis-catalog` in `doc-sync` and CI. A new event with no `@mode` tag, a tag that contradicts its signature, or an unclassified signature type fails the generator outright.
- Event and service-method contracts have a single home — the JSDoc at the declaration. The catalog repeats that original JSDoc inside its generated signature block and uses its description portion as entry prose, so thin source documentation yields a thin catalog entry.
- The inherited tier is hand-summarized, so a vendor sync that adds/renames a cordis-core event or `ctx` member needs a matching edit to the curated table in `gen-cordis-catalog.ts`. This is the deliberate cost of not walking pinned vendor source; it changes rarely and is called out in the generator.
- `verify-event-taxonomy.ts` is deleted and the `docs/architecture.md` event table is gone; anyone who linked to a specific table row now lands on the generated catalog instead.
