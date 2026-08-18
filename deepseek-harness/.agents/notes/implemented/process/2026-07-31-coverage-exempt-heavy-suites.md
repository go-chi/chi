# Agent Note: Coverage-exempt heavy suites

Status: implemented

English | [中文](2026-07-31-coverage-exempt-heavy-suites.zh.md)

## Problem

The CI coverage lane (`check:ci:coverage`) had its wall clock pinned by a handful of heavy test files: in a local 6-worker full-suite profile, 555 test files aggregated 1595 seconds, with `packages/typert/generator/tests/type-model.spec.ts` alone at 885 seconds and the top 10 files holding 84% of the aggregate. These suites share one shape — every case performs whole-workspace compiler analysis or drives real subprocess fixtures — and v8 instrumentation multiplies exactly that kind of runtime.

The decisive waste: the instrumentation tax these suites paid contributed **nothing** to the per-file 100% thresholds — the measured code they execute in-process is either outside the threshold scope already or independently fully covered by other suites. Running them instrumented traded lane time for zero information.

## Decision

The `ci-coverage` aggregate splits into two parallel gates; every test still runs, and only the heavy suites stop paying the instrumentation tax:

- **Instrumented gate** (`test:coverage`): sets `DSH_COVERAGE_EXEMPT_HEAVY=1`, which makes `vitest.config.ts` drop the exempt suites from both projects' excludes; every remaining file runs instrumented and carries the entire threshold proof. The variable is injected through the gate's own env (the existing `Gate.env` mechanism), not the workflow-global environment, so the uninstrumented gate beside it and any local `vitest run` never see it and behave unchanged.
- **Uninstrumented gate** (`test:coverage-exempt-heavy`): runs exactly the exempt suites through paired positional filters, keeping the correctness signal whole.

`scripts/coverage-exempt.ts` is the single roster point, holding the membership contract and the filter/exclude pairs so the two sides cannot drift.

### The roster, reconciled entry by entry

A suite contributes to coverage exactly when it executes measured files in-process (`coverage.include` spans the package src trees). The current roster, audited:

| Exempt suite | Measured code executed in-process | Who carries the coverage |
| --- | --- | --- |
| All 6 typert generator specs | The generator's own src | Generator src is threshold-excluded as a package (`vitest.config.ts`) — outside the threshold scope to begin with |
| tools-catalog.spec additionally imports | `typert-registry` and `tool-cordis` src | Each package's own tests cover them fully (verified with focused coverage runs, zero threshold errors) |
| `scripts/install-lefthook.spec.ts`, `scripts/oxlint-contract.spec.ts`, `scripts/change-scope.spec.ts` | None — they test `scripts/` sources (never in `coverage.include`) and work by spawning child processes | Nothing to carry |

### Membership contract

A new exemption must satisfy both: every measured file the suite executes in-process is already fully covered by other suites (or threshold-excluded), and the filter and exclude select exactly the same file set. The contract text lives beside the roster in the same file.

### The gate polices the roster automatically

The per-file 100% thresholds are themselves the roster's guard; a wrong roster cannot pass silently:

- If a future exempt suite in fact solely covers some measured file, the instrumented gate goes red on the spot (that file drops below 100%).
- The converse holds too: new code covered only by an exempt suite turns the gate red immediately.

Coverage-result invariance therefore does not rest on humans maintaining the roster, in line with the misconfiguration-fails-loud convention. The only thing given up is that the exempt suites' own execution no longer produces coverage data — the table above shows that data was entirely redundant, so the final report is file-for-file identical in threshold terms.

## Alternatives considered

- **CLI `--exclude` to drop the exempt suites from the instrumented gate.** Proven ineffective: vitest 4's `cliExclude` does not participate in per-project include resolution, so under a multi-project config the exempt suites stayed selected; the env + config route replaced it.
- **Lowering worker counts or raising gate concurrency.** Measured ineffective during the incident: the lane's wall clock was pinned by the longest tail files (aggregate/wall ≈ 4× effective parallelism), and the concurrency knobs moved nothing in either direction.
- **Cross-runner sharding (`--shard` + blob merge).** Would compress the wall clock further but adds matrix, artifact-pipeline, and merge-job complexity; with the split landed the lane sits near 2 minutes, which does not justify the cost. Revisit if the suite grows substantially.
- **Deleting or skipping the heavy suites.** Rejected: they are the sole correctness evidence for the typert generator and the scripts tooling; running them uninstrumented in parallel preserves the full signal.

## Verification

Measured on CI (16-core runner): the gate segment went from 424 seconds to the two gates in parallel — `test:coverage` 95.9 s + `test:coverage-exempt-heavy` 71.1 s — with the lane converging on the slower at about 96 seconds; the instrumented gate reported zero threshold errors both before and after the split. `vitest list` verifies the env toggle adds and removes exactly the exempt set; `run-gates.spec.ts` covers the aggregate graph construction.

## Consequences

- The coverage lane's gate segment drops from about 7 minutes to about 96 seconds with no change in threshold outcome or executed test set.
- `DSH_GATE_CONCURRENCY` has two schedulable gates in this lane again, so the aggregate scheduler is no longer a pass-through.
- Adding a heavy suite to the roster requires the membership audit above; a wrong entry fails the instrumented gate loudly rather than eroding coverage silently.
- The exempt suites no longer appear in the coverage report's file list of contributors; their correctness signal lives solely in the uninstrumented gate's pass/fail.
