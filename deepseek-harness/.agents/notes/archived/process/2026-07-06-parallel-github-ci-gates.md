# Agent Note: Parallel GitHub CI gates

Status: implemented
Archived: 2026-07-26

English | [中文](2026-07-06-parallel-github-ci-gates.zh.md)

## Problem

The keyless GitHub CI gates are mostly orthogonal: typecheck, lint, documentation freshness, coverage, snapshot replay, build, package-publication hygiene, demo smoke, and built-bin smoke fail for different reasons and do not need each other's runtime state. Running them as one ordered command chain makes the workflow wall clock equal the sum of those gates, while splitting every short leaf into its own GitHub job repeats checkout, Node setup, pnpm restore, and install work until orchestration overhead becomes the bottleneck.

The original broad-lane split stopped meeting that balance as the workspace grew. On the merge of PR #404, Linux static, coverage, snapshot, and artifact jobs took 148, 195, 94, and 230 seconds; Windows static and artifacts took 251 and 482 seconds. Package-manager packing once per package dominated both artifact validators, coverage needlessly rebuilt output before a source-only suite, and CPU-heavy gates contended inside the static and coverage lanes.

The artifact boundary remains load-bearing. `publint`, `verify-node-next-types`, compiled invariant loading, and built-bin smoke tests need emitted `lib/` output. Sharding cannot race those consumers ahead of build or replace their published-artifact signal with source execution.

## Decision

The production topology below is historical and is superseded by [Evidence-based larger hosted runners](2026-07-22-evidence-based-larger-hosted-runners.md). The larger-runner decision removes its shard selectors and workflow jobs; this note preserves why that earlier topology was implemented.

[CI](../../../../.github/workflows/ci.yml) treats one minute for non-Windows jobs and three minutes for Windows jobs as observed performance targets, not cancellation deadlines. Hosted-runner variance should leave complete timing evidence and useful failure logs instead of cancelling an otherwise-correct gate. The [serial cross-platform CI reference](2026-07-21-serial-cross-platform-ci-reference.md) independently runs the complete unsharded primary Node aggregate on Linux, macOS, and Windows so the optimized lane inventory is not its own completeness oracle.

In that topology, [scripts/run-gates.ts](../../../../scripts/run-gates.ts) was the common bounded scheduler and GitHub supplied explicit shard names for the expensive gate families. `scripts/static-shards.ts` partitioned static gates into foundation, documentation-type, API-contract, catalog, prose, documentation-projection, and documentation-build ownership and rejected a missing or duplicate gate assignment. Linux lint used disjoint A-C, D-M, N-S, and T-Z package-source and package-test lanes, while Windows used complete package-source and package-test lanes; both included a repository complement starting from `.` so new top-level targets could not disappear between shards and owned the single cross-file duplication run. `scripts/coverage-shards.ts` assigned every workspace package to exactly one source-coverage lane. Directory filters retained a trailing separator because Vitest positional filters match substrings and would otherwise admit prefix-named siblings. Each coverage lane included only its owned source files, repeated the exhaustive companion topology test, and ran without a preceding build because the complete coverage suite passes from a tree with every generated `lib/` removed.

Snapshot replay used two explicit multi-file lanes and eight scenario partitions of the large ACP file. `scripts/snapshot-shards.ts` owned that inventory, and its test discovered every file admitted by the snapshot config. Each snapshot job installed dependencies while its Linux runner prepared Bubblewrap, built the shipped runtime, and ran only its assigned replay surface. The suite retained bounded concurrency of five subprocesses because replay spent most of its time waiting on child protocol I/O. Fixture guards still inspected the complete ACP scenario table in every partition.

Cold standalone documentation typechecking rebuilds the complete project-reference graph, so a dedicated documentation-type lane builds once and checks Markdown blocks against those declarations. The Linux documentation lane uses VitePress's MPA build to retain page rendering and dead-link validation within the observed non-Windows target; separate blocking Windows build and production-site lanes preserve the emitted-package and shipped-site checks without putting both critical paths in one job.

Artifacts use two lanes: one metadata lane for `publint`, NodeNext declarations, and compiled invariant loading, plus one built-bin smoke lane. Each lane produces its own build before its consumers. Repeating the short build costs runner minutes but avoids an upload/download dependency and keeps each job's critical path bounded.

[scripts/publint-all.ts](../../../../scripts/publint-all.ts) calls publint's supported API in-process against an in-memory publication view made from each manifest's declared files and npm's mandatory metadata files. This preserves the distinction between workspace files and published files without spawning a package-manager pack command 103 times. [scripts/verify-built-package-invariants.mjs](../../../../scripts/verify-built-package-invariants.mjs) stages those structurally validated manifest-declared `lib/` files below the real package, then imports the compiled self-reference through plain Node and Cordis Loader normalization. A companion that reaches an undeclared runtime chunk still fails.

Compatibility lanes run the source worker and Zstandard runtime smokes on every advertised Node line. TypeScript checks the source graph once in a dedicated primary Node 24 lane; repeating the same compiler analysis in runtime compatibility jobs added time without runtime-specific signal.

The workflow caches the pnpm store, keys each immutable ESLint cache to its owning lint shard, preserves native PowerShell for Windows measurements, and retains one aggregate `all checks passed` status for branch protection. Windows reuses the three exhaustive lint partitions and groups foundation/catalog/prose plus documentation-type/API-contract gates behind shared runner setups; only scheduling differs from the Linux partitions. Windows build and production-site validation remain blocking, while the wider Windows static, lint, and artifact matrix remains observational.

## Alternatives considered

- **Keep the broad lanes** - minimizes workflow YAML, but it preserves the measured multi-minute feedback loop.
- **Run every leaf gate as a separate GitHub job** - maximizes fan-out, but short generators and prose checks would spend more time preparing a runner than checking the repository.
- **Upload one build to artifact consumers** - avoids repeated compilation, but upload/download and dependency scheduling lengthen wall time; the clean build is short enough to repeat inside bounded lanes.
- **Keep package-manager packing in both publication gates** - delegates inventory selection to pnpm, but repeats more than 200 package-manager processes. The manifest structural gate plus publication-view fixtures make the optimized inventory contract explicit and fail on an on-disk but unpublished dependency.
- **Keep build before coverage** - provides emitted output the source suite no longer consumes; a clean-tree coverage proof showed it was pure latency.
- **Typecheck on every Node version** - repeats compiler work while the compatibility smokes already exercise actual Node-specific loading and compression behavior.

## Consequences

The shard inventories and matrix jobs described above are not part of the current repository contract. The superseding larger-runner decision keeps the complete primary inventory in one process and uses the serial suite as its independent completeness oracle.

The optimized publication validators rely on the manifest `files` contract enforced by `verify-package-invariants`. If publication rules grow beyond that contract, the structural gate and both staged views must change together.

Compatibility jobs no longer claim that TypeScript itself was exercised under every Node runtime. They prove runtime-sensitive source loading on Node 22, 24, and 26, while the primary runtime owns the single source-graph typecheck.
