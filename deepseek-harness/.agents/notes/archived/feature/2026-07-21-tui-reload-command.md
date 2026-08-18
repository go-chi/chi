# Agent Note: The /reload command re-reads loader configs on demand

Status: implemented
Archived: 2026-07-26

English | [中文](2026-07-21-tui-reload-command.zh.md)

## Problem

HMR's file watcher only reacts to in-place `change` events under its configured roots (the config leaf's directory in the shipped demos). Editors that replace files by rename (BSD `sed -i`, `git checkout`) produce no event, and runtimes without the HMR entry have no config reload path at all. During development that means restarting the TUI to apply a config edit the watcher missed. Widening the watch roots to the whole repo was considered and rejected in discussion: dense package sharing makes module-level HMR a remount-most-of-the-tree operation with unpredictable externals boundaries.

## Decision

`dsh-tui` gains an **experimental, dev-only** `/reload` slash command: it walks `ctx.loader.entries()` and calls `refresh()` on every file-backed subtree (`Include`), i.e. the exact code path the HMR watcher's config-change branch drives, invoked manually and watcher-independent. Unchanged files are no-ops (content comparison in `Include.read`); invalid files warn and keep the running tree (the hot-reload-resilience contract); include `patches` — including the dsh CLI's personal overlay — re-apply on every re-read.

The TUI reaches the Loader **structurally** (`ctx.loader` via a local type, not `inject`): tests and embedders run the TUI without a Loader, where `/reload` degrades to a warning notice instead of failing the mount. Module-source hot reload stays watcher-owned; `/reload` refreshes configs only.

## Alternatives considered

**Widening the HMR watch roots to `packages/`/`apps/`.** Rejected for now: plugin-source changes reload every dependent plugin's fiber, and the repo's dense shared packages (`dsh-session`, `dsh-llm`, `dsh-tools`) make that a teardown of the spine and the UI mid-session — a restart in disguise with partial-reload hazards. A manual config-scope command captures the safe, predictable subset.

**Declaring `loader` in `inject`.** Rejected: it would make the Loader a hard dependency of the TUI, breaking every Loader-less composition (unit harness, embedders) for a dev convenience.

**A `cordis_reload` model-facing tool in dsh-tool-cordis.** Rejected: this is an operator action for the human at the terminal, not a capability the model should trigger; the cordis toolset's mount/unmount surface already covers the model's runtime-modification story.

## Consequences

- `/reload` appears in the help line, autocomplete (marked EXPERIMENTAL (dev)), and the two help-rendering snapshots (re-recorded).
- The command reports tree count and completion as transcript notices; per-file failures surface only in loader logs, which the TUI does not display — acceptable for a dev-only surface, noted in the completion message.
- A re-entrancy guard serializes reloads: `/reload` while one is in flight is refused with a warning, keeping the loader's unmutexed tree-update pass single-writer; the guard releases on completion or failure.
- `/reload` runs only while the agent is idle: a reload can dispose and re-mount entries, which under an active turn could tear tools or the adapter out from under in-flight calls. The check is advisory (a send can race in after it) but removes the common footgun.
- If `refresh()`'s never-reject contract ever changes, the command reports the failure instead of leaving an unhandled rejection.

## Testing

`packages/ui/tui/tests/tui.spec.ts` pins: `/reload` refreshes every file-backed subtree and skips plain entries (structural fake Loader), reports completion, refuses re-entry while a gated refresh is in flight and runs again after release, releases the guard on the failure arm, refuses a running agent and runs again at idle, reports a rejecting refresh, and degrades to a warning without a Loader — including mounted as a real plugin fiber, where a throwing service lookup would escape. Verified live in tmux against the real tree: probe edit → reload applies; invalid edit → reload keeps the running tree.
