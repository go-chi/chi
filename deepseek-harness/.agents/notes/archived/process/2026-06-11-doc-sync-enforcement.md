# Agent Note: Doc-sync enforcement

Status: implemented
Archived: 2026-07-26

English | [中文](2026-06-11-doc-sync-enforcement.zh.md)

## Problem

AGENTS.md promises that docs and code stay strictly in sync, but the promise was verified by eyeball. Review caught drift twice — a cookbook example contradicting the type policy, and a README citing the wrong `registerAdapter` call. Out-of-sync docs are worse than no docs, and this codebase is built primarily by agents that follow gates far more reliably than prose (mechanical quality gates). Two classes of doc drift are mechanically checkable: code blocks that no longer compile, and the event-taxonomy table that duplicates the `interface Events` declarations.

## Decision

Two gates, mirroring the existing `scripts/` style (tsx ESM, one job each):

1. **`doc-typecheck`** extracts every fenced ` ```ts ` block from `README.md`, `docs/**`, and `packages/*/README.md`, writes them to a temp project extending the root `tsconfig.json`, and compiles it with `tsc -b`. The temp project reuses the source `paths` map and the root project references, so documentation examples see source while vendored code remains checked under its own tsconfig settings. A block that is a deliberate sketch opts out with an explicit ` ```ts ignore-check ` info string; the script reports the opt-out ratio and fails if it exceeds half, so the escape hatch can't quietly become the norm.
2. **`verify-event-taxonomy`** extracts the event names from the `interface Events` blocks across `packages/*/src` and from the taxonomy table in `docs/architecture.md`, and asserts the two sets match exactly. Verify, don't generate: the table keeps its hand-written Mode/Purpose columns; only the set of names is checked. (Landing this surfaced three events the table had been missing — `tools/change`, `llm/adapter-change`, `system-prompt/change`.) **Superseded** by [the generated cordis catalog](2026-06-20-generated-cordis-catalog.md): this gate and its `architecture.md` table are retired in favor of the fully-generated `docs/cordis-catalog/events.md` + `docs/cordis-catalog/services.md` and their `verify-cordis-catalog` freshness gate. The other gates here (`doc-typecheck`, and the `verify-md-wrap` amendment below) are unaffected.

Both run via a shared `doc-sync` package.json script that contributors invoke for relevant documentation changes and CI invokes exhaustively. The [fast local Git hooks](2026-07-22-fast-local-git-hooks.md) decision keeps this surface-selected work out of commit and push hooks.

**Amendment (2026-06-17):** a third gate, **`verify-md-wrap`**, was later folded into `doc-sync`. It parses each in-scope Markdown file (`README.md`, `docs/**`, `packages/*/README.md`, plus `AGENTS.md` / `packages/AGENTS.md`) with `mdast-util-from-markdown` + GFM and fails on any `paragraph` node spanning more than one source line, enforcing the docs/AGENTS.md "one physical line per paragraph" writing rule. Same verify-don't-generate principle: it reports hard-wraps and never rewrites, so it adds no formatting churn. `doc-sync` is now three gates.

## Alternatives considered

- **API-extractor golden reports** ([the deferred proposal](../../proposed/process/2026-06-11-api-extractor-reports.md)) — deliberately deferred: low value for an internal monorepo where reviewers already see the source diff, and a heavy, finicky dependency.
- **Generating the taxonomy table from source** instead of verifying names — rejected as more machinery than the problem warranted; the table kept its hand-written Mode/Purpose columns until [the generated cordis catalog](2026-06-20-generated-cordis-catalog.md) superseded the check entirely.

## Consequences

- Doc drift in the checkable classes fails `doc-sync` and CI instead of waiting for a reviewer to notice. This is an instance of the "mechanical gates over prose" principle.
- Making doc snippets compile costs a few stub imports/`declare`s; the `ignore-check` ratio must stay low or the gate is theater (the ratio guard enforces this).
- The taxonomy check is name-only — a wrong Mode or Purpose column still needs human review.
- API reports remain available to revisit if the packages are ever published externally.
