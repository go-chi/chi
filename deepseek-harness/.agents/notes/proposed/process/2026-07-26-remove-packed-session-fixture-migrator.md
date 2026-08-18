# Agent Note: Remove the packed-session fixture branch migrator

Status: proposed

English | [中文](2026-07-26-remove-packed-session-fixture-migrator.zh.md)

## Problem

The repository's default writers and snapshot check keep session fixtures in the canonical packed-row layout. `pnpm run migrate:packed-session-fixtures` remains alongside that permanent enforcement only so in-flight branches carrying older fixture edits can merge current `master` and mechanically converge without re-recording model output.

Once every such branch is merged, closed, or already canonical, the write command and its branch-convergence instructions have no continuing owner. Keeping a mutation command after its transition ends adds a second apparent maintenance path beside the permanent read-only snapshot check.

## Proposal

Remove the temporary `scripts/migrate-packed-session-fixtures.ts` CLI and the root `migrate:packed-session-fixtures` package command after a live inventory confirms that no open pull request still needs to convert session-format JSONL. Remove the transitional command links from the testing policy, the ACP snapshot README, and the implemented packed-row Agent Note in the same change; replace the command-specific remediation text in `scripts/session-fixture-layout.snapshot.ts` with command-independent canonical-layout guidance.

Retain `scripts/session-fixture-layout.ts`, its unit tests, and `scripts/session-fixture-layout.snapshot.ts`. They define and enforce the permanent canonical layout; only the branch-facing writer is temporary.

Before removing the command, each affected branch merges the current `master`, runs the migrator once, commits the resulting fixture-only rewrite separately, and verifies that the repository-wide snapshot layout check passes. Closed or superseded branches require no migration.

## Alternatives considered

**Keep the command indefinitely.** This makes old fixture conversion convenient, but it leaves a repository-wide mutation tool after the only known migration window closes. The read-only gate already supplies the durable behavior and diagnostic.

**Remove the canonicalization module with the CLI.** The module is not transition residue: snapshot CI uses it to discover future fixtures, decode mixed physical records, and compare them with the canonical packed representation. Removing it would also remove enforcement.

**Delete the command immediately when packed rows reach `master`.** Older open branches would then need ad hoc scripts or manual snapshot regeneration after retargeting, increasing conflict risk and making decoded-event preservation harder to review.

## Acceptance criteria

- A live open-PR inventory finds no branch with session-format JSONL changes that still depends on the temporary migration command.
- The temporary CLI, root package command, every branch-convergence link, and the command-specific gate diagnostic are absent; the permanent canonicalizer, unit tests, and snapshot check remain.
- `pnpm run test:snapshot`, `pnpm run doc-sync`, lint, and whitespace validation pass without the temporary command.
- Current documentation describes only the packed default and permanent canonical-layout enforcement.

## Risks

An incomplete open-branch inventory could strand a contributor with a large unpacked fixture conflict after the command disappears. The removal therefore depends on live pull-request evidence, not elapsed time. Retaining the command too long has a smaller operational cost but obscures which mechanism is permanent.
