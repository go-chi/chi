# Agent Note: Parallel pre-push gates

Status: implemented

English | [中文](2026-07-06-parallel-pre-push-gates.zh.md)

The local-hook portion of this record is superseded by [Fast local Git hooks](2026-07-22-fast-local-git-hooks.md). The bounded gate scheduler and package-level `publint` parallelism remain in force for CI, `doc-sync`, and explicit local commands.

## Problem

Aggregate jobs such as documentation synchronization hide long sequential chains whose members are read-only and independent. Duplicating their leaf inventory in workflow YAML gives future script changes multiple places to drift, while running package publication checks serially makes one gate consume time proportional to the package count.

## Decision

[scripts/run-gates.ts](../../../../scripts/run-gates.ts) owns the bounded scheduler used by CI, `doc-sync`, and the opt-in `check:all` command. It expands named modes into leaf gates, rejects empty or ambiguous dependency graphs before starting a child, respects artifact dependencies, buffers attributable output, reports exit and signal outcomes independently, and accepts `DSH_GATE_CONCURRENCY` when a caller needs a different worker bound.

The Node 24 consumer job is one seven-gate mode rather than a shell-owned process pool. Its default worker count equals its gate count while dependencies control readiness: `publint` precedes built-package invariant validation, and snapshot replay, NodeNext type checks, built-bin smokes, and lint wait for that validation. Lint waits because the invariant verifier temporarily stages package views that the linter must not traverse; source compatibility checks can overlap the validation chain.

[scripts/publint-all.ts](../../../../scripts/publint-all.ts) discovers packages from `packages/<group>/<pkg>` and runs `publint` with a worker pool sized from `availableParallelism()`. `DSH_PUBLINT_CONCURRENCY` can cap or raise the worker count for local machines and CI runners with different resource profiles. Results are buffered per package and printed in deterministic package order, so parallel execution does not scramble each package's log block.

The per-gate package scripts remain the vocabulary for ad hoc local runs. `hygiene` stays an aggregate `&&` chain, while `doc-sync` owns its member list in the scheduler ([doc-sync through the gate scheduler](../../archived/process/2026-07-21-doc-sync-through-gate-scheduler.md)).

## Verification

[scripts/run-gates.spec.ts](../../../../scripts/run-gates.spec.ts) rejects invalid graphs before the executor runs, pins the consumer inventory and dependency edges, and exercises signal termination through a real child process. [scripts/publint-all.spec.ts](../../../../scripts/publint-all.spec.ts) rejects a missing public export before downstream artifact consumers run.

## Alternatives considered

- **Keep aggregate jobs serial** — simpler execution but makes wall clock equal the sum of independent checks and repeats command-wrapper startup.
- **Declare one CI job per leaf gate** — exposes maximum workflow parallelism but repeats checkout, setup, and install overhead and duplicates the scheduler inventory in YAML.
- **Background subcommands inside shell scripts** — parallelizes work but loses per-gate timing, deterministic failure grouping, and straightforward signal handling.
- **Declare one `publint` job per package** — exposes maximum package parallelism but creates a hand-maintained package inventory that drifts when packages change.
- **Run `publint` with unbounded concurrency** — minimizes elapsed time on small repositories only by gambling with process count, memory pressure, package tarball creation, and readable logs.

## Consequences

Scheduler-backed commands take the slowest dependency chain instead of the sum of independent gates and report the gate that dominates. Invalid graphs fail before partial execution. The cost is a custom scheduler with an explicit mode inventory.

The consumer validation chain delays restored-artifact consumers and lint until the shared artifact view is known-good and transient staging is gone; those downstream gates can still overlap one another.

`publint-all.ts` is asynchronous and buffers command output instead of inheriting stdio live. The payoff is package-level parallelism with stable output order and one environment variable for resource tuning.
