# Agent Note: `dsh meta` boots the TUI over the harness checkout

Status: implemented
Archived: 2026-08-03

English | [中文](2026-07-28-dsh-meta-source-workspace.zh.md)

## Problem

`dsh` treats the invoking directory as the workspace, which is what makes it useful on arbitrary projects. Working on dsh itself therefore means `cd`-ing to the checkout first — and the checkout is not a memorable path: the source install keeps it under a container directory as a timestamped staging worktree (`~/.dsh/source/staging-<timestamp>`) behind a `current` symlink, so the target moves on every upgrade. The agent is already *told* where its source lives by the `harness:source` prompt section, and the `cordis` toolset can modify that runtime, but the human still had to locate the directory by hand to start a session there.

## Decision

`dsh meta` boots the ordinary TUI with the harness checkout as the workspace, from any directory.

The target is `SOURCE_ROOT` in `apps/cli/src/tui.ts` — `fileURLToPath(new URL('../../..', import.meta.url))`, three hops up from `apps/cli/{src,lib}` — the same constant the `harness:source` prompt section already names, so the workspace and the path advertised to the model cannot drift. It follows the launcher's real path, so a PATH symlink through `current` resolves to whichever staging worktree is active.

The mechanism is one `process.chdir(workspace)` inside `runTui`, guarded by an optional third parameter that only the `meta` dispatch passes. The cwd *is* the workspace seam in the shipped tree: `examples/tui-agent/cordis.yml` derives the session cwd (`!!js process.cwd()`), the `./.sessions` persistence root, and the HMR watch root (`root: ['.']`) from it, so one chdir moves all three together and meta sessions land in the checkout's gitignored `.sessions/`. It runs after both `.env` layers are loaded — the bin's invoking-directory load and the personal one — so the ambient > project > personal precedence is untouched. `DEFAULT_CONFIG` and `SOURCE_ROOT` are absolute and TUI mode passes no snapshot mode, so config resolution is chdir-independent.

`meta` always starts a fresh session and accepts no default-surface options; its only option is the [experimental gate](2026-07-31-experimental-subcommand-gate.md)'s `--experimental`. `--config` would boot a foreign tree against the harness workspace, which is the default surface's `--config` case rather than this command; `-p` is not interactive, and resume re-enters the persisted session's own workspace through `dsh --resume <id>`. Any leaked default-surface option fails loud.

## Testing

`apps/cli/tests/args.spec.ts` pins routing for `meta`, rejection of every leaked default-surface option, and rejection of the former `experimental-meta` name. The dispatch itself is composition inside `bin.ts`'s existing `v8 ignore` block.

There is no keyless PTY smoke for this mode. The smoke harness gives each run a temp cwd, but `dsh meta` deliberately chdirs to the real checkout, so a smoke would write `.sessions/` into the live tree mid-test. Covering it properly needs an injectable target directory — a test-only seam this note declines to add for a one-line chdir.

The mode was verified interactively instead. Launched from `$HOME`, a `pwd` tool call reports the checkout, git resolves to its branch, the session log lands under the checkout's `.sessions/` (leaving `~/.sessions` untouched and the tree free of unignored residue), and plain `dsh` from another directory still uses the invoking one.

## Alternatives considered

**Thread an explicit workspace through `boot` and the config tree.** Avoids mutating process-wide state, but the shipped config reads the cwd in three places (`!!js process.cwd()`, `persistenceRoot`, HMR `root`), so each would need its own new plumbing and config key to stay consistent. `chdir` before boot expresses "this is the workspace" once, at the seam that already means it.

**An `--experimental-meta` flag on the default surface.** Rejected: the default surface is option-only so that subcommands do not collide with a positional, and a flag that silently relocates the workspace reads as a modifier of the current directory rather than a different target. `meta` alongside `web` matches the existing shape.

**Resolve `~/.dsh/source/current` instead of the launcher's own path.** Rejected: it would diverge from the `harness:source` prompt path whenever a non-installed checkout's `bin/dsh` is invoked directly, telling the model one source root while working in another.

## Consequences

Starting a session on dsh's own source is `dsh meta --experimental` from anywhere (or bare `dsh meta` under `DSH_EXPERIMENTAL=1`), and the workspace is guaranteed to be the same checkout the model is told about. The command always starts fresh; an ordinary `dsh --resume <id>` later restores the session and enters its persisted workspace.

`runTui` gains an optional third parameter, so the workspace override is visible at the one function that owns TUI composition rather than hidden in a second copy of it.
