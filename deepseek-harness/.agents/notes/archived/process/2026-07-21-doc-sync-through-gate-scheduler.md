# Agent Note: doc-sync through the gate scheduler

Status: implemented
Archived: 2026-07-26

English | [中文](2026-07-21-doc-sync-through-gate-scheduler.zh.md)

## Problem

`pnpm run doc-sync` was a `&&` chain of 24 `pnpm run` subcommands. Each link paid a full pnpm wrapper start (workspace resolution, script lookup, tsx boot) before its script ran; measured on a development host, the 24 script bodies together finish in about 34 seconds while the chained form takes around 3 minutes, and the wrapper stall reproduces on local disk, so every developer and CI lane pays it, not just network-filesystem checkouts. The chain also ran serially even though the member gates are read-only and independent, and it silently drifted from [scripts/run-gates.ts](../../../../scripts/run-gates.ts): `verify-cordis-api` joined the chain when the runtime API catalog landed but was never added to `docSyncLeafGates`, so CI never enforced that catalog's freshness.

## Decision

`doc-sync` in `package.json` delegates to the existing bounded scheduler — `tsx scripts/run-gates.ts doc-sync` — like the `check:ci:*` scripts ([parallel gate scheduling](2026-07-06-parallel-pre-push-gates.md), [current CI topology](2026-07-22-evidence-based-larger-hosted-runners.md)). The `doc-sync` mode expands to exactly `docSyncLeafGates()`, making the leaf list in `run-gates.ts` the single source of truth for the member set. The local mode caps default concurrency at four workers because several doc gates each build a full `ts.Program`; `DSH_GATE_CONCURRENCY` still overrides.

`docSyncLeafGates` includes `verify-cordis-api`, so relevant local documentation checks and CI gate the generated runtime API catalog alongside the other generated docs.

## Alternatives considered

- **Keep the `&&` chain and only fix the missing leaf** — repairs today's drift but keeps two member lists that will drift again, and keeps the 24 serial pnpm wrapper starts.
- **A dedicated `scripts/doc-sync.ts` importing each verify module in one process** — saves even the per-gate tsx boot, but requires refactoring all 24 scripts from run-at-import to callable entry points and loses the scheduler's per-gate timing, isolation, and failure grouping; the wrapper start the scheduler already avoids is the dominant cost.
- **Shell loop over `tsx scripts/*.ts`** — avoids pnpm wrapper starts cheaply but adds a second execution vocabulary next to the scheduler CI already uses, with none of its scheduling or reporting.

## Consequences

One `pnpm run doc-sync` now costs one pnpm wrapper start plus the slowest dependency chain of member gates instead of 24 wrapper starts plus the sum of all members. Adding a doc gate is one edit in `docSyncLeafGates` (plus the package script itself for ad hoc runs); `package.json` keeps the per-gate `verify-*` scripts as the vocabulary for running one gate by hand. The scheduler prints per-gate timing, so a slow doc-sync points at the gate that dominates. `pnpm run doc-sync` output is now interleaved scheduler output rather than sequential per-command output; anything parsing that output must key on the `run-gates:` summary lines.
