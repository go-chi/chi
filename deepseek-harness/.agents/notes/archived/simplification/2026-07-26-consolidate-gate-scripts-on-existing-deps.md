# Agent Note: Consolidate gate scripts on already-present deps and builtins

Status: implemented
Archived: 2026-07-27

English | [中文](2026-07-26-consolidate-gate-scripts-on-existing-deps.zh.md)

## Problem

The `scripts/` gates mostly used the right tools (`node:fs` `globSync` in 15+ gates, mdast/micromark in the markdown gates), but a handful of stragglers hand-rolled what a sibling gate already did with an existing dependency or builtin:

- **Duplicated fence scanners.** `scripts/md-fences.ts` (~55 lines, consumed by `doc-typecheck.ts`) and `extractEquivBlocks` in `scripts/verify-type-equiv.ts` (~39 lines) were two copies of the same regex line-scanner for fenced code blocks, while `scripts/verify-mermaid.ts` already extracted fences by visiting mdast `code` nodes — and `markdownProseLines` in `scripts/markdown.ts` itself parsed to mdast but then hand-tracked fence state with a second regex. The regex scanners only recognized backtick fences at column 0, so they silently disagreed with the mdast-based gates on tilde and indented fences.
- **Hand-rolled argv parsing.** `parseOptions` in `scripts/publint-all.ts` and its near-identical copy in `scripts/verify-built-package-invariants.mjs` (~26 lines) stepped argv indexes manually, while sibling scripts (`verify-runtime-closure.ts`, `build-exe-for-python-sdk.ts`, `packages/sdk/scripts/src/args.ts`) already used the `node:util` `parseArgs` builtin.
- **Hand-rolled directory walks.** Five sites re-derived nested `readdirSync` walks that `globSync` covers: `verify-runtime-closure.ts` (packages + vendor manifests), `dev-web.ts` `discoverPluginDirs`, `verify-package-paths.ts` `realPackageNames`, `verify-client-domain-graph.ts` `listSources`, and `publint-all.ts` `addPath` (~55–65 lines total). `scripts/package-invariants.ts` shows the one-line `globSync` template.

No new dependency was needed anywhere; every replacement is an existing devDep or a Node builtin.

## Decision

- A shared mdast fence helper, `markdownFences` in `scripts/markdown.ts`, visits `code` nodes for the language, full info string, body, and 1-based opening-fence line; `doc-typecheck.ts` and `verify-type-equiv.ts` extract fences through it. `md-fences.ts` and the duplicated `extractEquivBlocks` scanner are deleted, and `markdownProseLines` derives fenced lines from the parsed `code` nodes' positions instead of a second regex.
- Both CLIs parse argv via `parseArgs`; unknown options and missing values still fail loud, with `parseArgs`'s own error text instead of the bespoke usage strings.
- The five straggler walks use `globSync`. The walks in `check-workspace-constraints.ts` and `clean.ts` stay: they need dirent-level detail to diagnose malformed trees, which glob-by-pattern cannot report.

## Alternatives considered

- **A new glob/walking dependency (`tinyglobby`, `fdir`).** Rejected: the builtin already won repo-wide; these were stragglers, not a gap.
- **`p-map` for `publint-all.ts`'s ~19-line ordered worker pool.** Deliberately left out: one new devDep for one small deletion is at the edge of the [dependency policy](../process/2026-07-26-dependencies-over-hand-rolling.md) bar, and the pool's requirements (bounded workers, deterministic order, env override) are documented in the [parallel-gates note](../process/2026-07-06-parallel-pre-push-gates.md). Fold it in only if `p-map` earns a second consumer.
- **Leaving the fence scanners.** Rejected: two drifting copies of a parser beside a third correct implementation is exactly the duplication the shared `markdown.ts` helper exists to prevent, and the column-0-backtick-only limitation was a latent inconsistency between sibling gates.

## Consequences

- One fence parser: every markdown gate now classifies fences through mdast, so tilde, indented, and 4-backtick container fences behave identically everywhere. The docs tree contained no fence shape the regex scanners mishandled, so gate results are unchanged on the tree that landed the swap: `pnpm run doc-sync` and each rewritten gate ran before and after with byte-identical output (`doc-typecheck` block/opt-out counts, `verify-type-equiv` match counts, `publint`, `verify-built-package-invariants`, `verify-runtime-closure`, `verify-package-paths`, `verify-client-domain-graph`, and both package-README prose gates).
- `verify-type-equiv` still rejects an unterminated type-equivalence fence: mdast silently closes an unterminated block at end-of-file (its comparisons could then pass), so the shared helper reports whether a closing delimiter exists and the gate errors on an unclosed block, preserving the removed scanner's rejection. The `doc-typecheck` scanner never had that error path.
- `parseArgs` keeps the last value of a duplicated option instead of erroring — a dev-tool edge case the tests don't pin, accepted in exchange for deleting the two bespoke parsers. (Strict mode still rejects a `--`-prefixed token where a value is expected, matching the replaced parsers.)
