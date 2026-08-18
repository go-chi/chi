# Agent Note: Share the app bins' boot glue instead of maintaining twin copies

Status: implemented
Archived: 2026-07-26

English | [中文](2026-07-04-share-app-bin-boot-glue.zh.md)

## Problem

The stdio and ACP bins duplicated environment loading, fail-loud handling, entry validation, and boot logic, including subtle Loader failure behavior. Their copies had already drifted and lived in self-executing files excluded from unit coverage, making their helper exports unusable.

## Decision

The helpers live once, in [`@deepseek-ai/dsh-app-boot`](../../../../packages/ui/app-boot) (`packages/ui/app-boot`, in the `ui` group because the bins are published artifacts whose runtime dependency must itself be published, not `support/`): `resolveConfigPath` (snapshot-aware, the single path resolver for both bins), `loadEnv`, `installFailLoud`, `assertEntriesLoaded`, and `boot`, each parameterized by the bin's diagnostic prefix and injectable at its side-effect seams (the warn sink, the process slice) so the unit suite covers every branch — including `boot()` driven in-process against the real Loader with relative-specifier configs, both the settled-tree happy path and the fiber-less-entry rejection. The package carries the per-file 100% coverage gate; the loader-failure lore has one home.

Each `bin.ts` is a thin self-executing composition over the shared helpers plus its app-specific lifecycle (the ACP bin: replay-mode env skipping and the stdin-EOF dispose; the stdio bin: nothing extra). The bins stay coverage-excluded and export nothing; the published-artifact guards are unchanged — the built-bin smokes still run each bin under plain node in a node_modules-shaped temp dir (now symlinking `ui/app-boot` too) and still assert the missing-config non-zero exit, per the "real entry path means the published artifact" defensive pattern. The [extract-example-app-packages Agent Note](../architecture/2026-06-20-extract-example-app-packages.md)'s bin-ownership facts are amended accordingly.

## Alternatives considered

### Why not keep the duplication?

The bins were framed as independently-owned published artifacts, and a new package carries fixed overhead (manifest, README, tsconfig reference, publint surface) comparable to the deduplicated line count. But app-vs-app sharing was never weighed by the Agent Note that created the bins — it consolidated three example `start.ts` copies INTO the bins and stopped there; the drift was observed fact; and the coverage-gap argument is independent of the dedup argument: this was the only nontrivial runtime logic in the repo exempt from the per-file 100% gate. The recorded fallback (extracting only the pure logic into per-app modules) would have ended the exemption but kept two homes for the lore.

## Consequences

- A boot-glue change (a new guard, a resolution fix) lands once and both published bins inherit it; the bins cannot drift apart again.
- `dsh-app-boot` stays dependency-light (cordis + the loader/include pair) — it is boot machinery, not app surface.
- The bins' own files are near-trivial compositions; everything with branches lives under the coverage gate.
