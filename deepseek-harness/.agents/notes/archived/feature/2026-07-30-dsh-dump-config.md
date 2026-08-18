# Agent Note: dsh --dump-config prints the composed config tree

Status: implemented
Archived: 2026-08-07

English | [中文](2026-07-30-dsh-dump-config.zh.md)

## Problem

The booted tree is a composition the user never sees: the shipped base, a surface overlay, and the `--config` or personal `~/.dsh/config.yaml` overlay apply as sibling patch lists where each id-targeted patch replaces the row's whole `config` and an unmatched id only warns. Debugging a misbehaving personal overlay (a restated field dropped, a row id typo, a patch applying to the wrong surface) required mentally replaying the patch algorithm across three files. There was no way to see the effective tree or to diff it against the shipped defaults.

## Decision

`dsh --dump-config` and `dsh web --dump-config` print the composed entry list — base, surface overlay, then the `--config` or personal overlay, exactly the layers that surface's boot assembles — as YAML on stdout and exit without booting. `dsh --dump-default-config` / `dsh web --dump-default-config` stop at the surface overlay, so diffing the two outputs shows precisely what the user layer changes.

The dump cannot drift from what boots because it shares the mounting code: the vendored include exports its patch algorithm as the pure `applyEntryPatches(data, patches, warn)` (the private `applyPatches` method now delegates to it) and its `!!js` YAML dialect as `entryListSchema`; `dsh-app-boot`'s `renderConfigDump()` composes labeled layers and renders through both, and `apps/cli/src/dump-config.ts` is a thin surface-selection wrapper. `!!js` expressions print verbatim and unevaluated — the dump shows composition, not one process's environment — and a patch whose target row is absent goes to stderr with its layer label, mirroring the Loader's boot-time warning. Launcher-owned boot-context values (session identity, web CLI-flag patches, the frontend dist path) are per-invocation facts outside the config tree and do not appear. The dump flags reject boot-only flags (`-p`, `--resume`, `--config-replace`) and each other, and `--dump-default-config` takes no `--config`.

Each run of same-provenance rows is preceded by a `# ==` comment naming the file that contributed the rows and the layers that patched them (`# == base.cordis.yml, patched by tui.cordis.yml`), so the output shows which section comes from which file while remaining one loadable YAML document. Composition is one flattened `applyEntryPatches` call over all layers — boot's exact call shape, so even patch-visibility corner cases (a later layer targeting a group child that a plain `config` replacement introduced, invisible to the single-pass id index) compose identically; applying one call per layer would rebuild the index between layers and print a tree boot never mounts. Provenance is derived from single-call prefix snapshots (base + layers 1..k) diffed positionally: the patch algorithm only rewrites rows in place or appends, so a top-level index identifies one row across snapshots, and a layer counts as having patched a row when adding it changed that row (config replacement, disable, group insert). Patch lists are cloned per snapshot because `applyEntryPatches` pushes `insert` rows by reference from the patch list.

`dsh-app-boot` previously duplicated the include's `!!js` YAML type for patch parsing; it now imports `entryListSchema`, so the dialect has one owner.

## Alternatives considered

**Boot the tree and dump `ctx.loader.entries()`.** Rejected: booting evaluates `!!js` expressions (leaking one machine's environment into the printed config), starts adapters and sessions as side effects, requires a TTY-independent teardown path, and is slow. The dump is for debugging composition, which is a pure function of the files.

**Reimplement the patch merge in the CLI.** Rejected: a second implementation of `applyPatches` would silently drift from the vendored include — the exact failure mode the feature exists to debug. Exporting the include's own algorithm costs one logged vendor modification and guarantees identity.

**A `/dump-config` TUI command instead of flags.** Rejected as the only form: the primary use is a piped `dsh --dump-config | diff - <(dsh --dump-default-config)` style workflow, which needs a boot-free non-TTY surface. A TUI command can be added later over the same `renderConfigDump`.

## Consequences

Config debugging becomes one command instead of mental patch replay, and support can ask for `--dump-config` output. The vendored include carries one more logged local modification (the `applyEntryPatches`/`entryListSchema` exports; behavior-preserving for mounting) to re-apply on upstream sync. Provenance tracking re-composes one prefix snapshot per layer and diffs rows by JSON stringify, so the dump does extra work proportional to layers² × rows; that cost lives only in the boot-free dump path. `renderConfigDump` is unit-tested for layer ordering, verbatim `!!js` round-tripping, provenance separators and grouping, labeled unmatched-patch warnings, and loud read/parse/shape failures; the built-bin e2e drives all four flag forms through `lib/bin.js` including the personal-overlay layer, its provenance label, and its stderr warning.
