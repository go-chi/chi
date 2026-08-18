# Agent Note: the installer adopts an existing checkout into the managed layout

Status: implemented
Archived: 2026-08-10

English | [中文](2026-07-31-installer-adopts-existing-checkout.zh.md)

## Problem

`scripts/install.sh` produced two incompatible installation layouts. A `curl … | sh` install built the managed layout — a master clone at `~/.dsh/source/master`, a staging worktree on `dsh-staging/<timestamp>`, and the stable `current` symlink the PATH launcher resolves through. Running the same script from a checkout instead linked `dsh` straight at that checkout's `bin/dsh`, per the earlier [in-repo skip-clone decision](../../archived/process/2026-07-22-installer-in-repo-skip-clone.md).

The direct link cannot be upgraded. `current` is what an upgrade repoints, so an install without it is not upgradable by [`dsh-upgrade`](../../../../skills/dsh-upgrade/SKILL.md); the PATH symlink dangles if the checkout moves; and the launcher resolves to whatever branch the contributor happened to have checked out, which the upgrade contract forbids as a launcher target. The upgrade skill already described this layout as a legacy install needing a one-time migration, so the layouts diverged at install time and were reconciled only later, if ever.

## Decision

In-repo mode still never clones and never modifies the working tree, but it now **adopts** the checkout into the managed layout unconditionally. There is no opt-out: one layout serves every install.

The container owns staging worktrees and `current`; the repository is *discovered*, not owned. `git rev-parse --git-common-dir` resolves the shared git directory behind the checkout — for a linked worktree that is the real clone rather than the worktree itself — and its parent is the repository that serves as the upgrade base. A staging worktree branched from the checkout's `HEAD` is then created under `$DSH_SOURCE`, and `current` points at it. A clone anywhere on disk therefore converges on the same layout as a `curl` install, and the two paths share one worktree/exclude/lock/link sequence: they differ only in whether the repository was discovered by `git clone` or by `git rev-parse`.

The installer records nothing about where that repository lives. A container whose repository sits outside it is not self-contained — each staging worktree holds an absolute gitdir pointer into that clone, so deleting the clone breaks them — but git already owns that fact: the worktree's `.git` file names the path, and `git worktree list` in the clone enumerates every worktree depending on it.

Adoption branches from `HEAD`, so committed work is what runs and uncommitted changes stay in the checkout. This is not prompted or warned about: the installer builds the layout and gets out of the way. Setting `DSH_SOURCE` to a different directory remains the one documented way to opt back into cloning a separate tree.

Every path comparison runs on physical paths through a `resolve_dir` helper, and every compared value is resolved at assignment rather than at the comparison. Git always reports resolved paths, so comparing one against an unresolved path disagrees whenever a symlink sits anywhere above the checkout — a symlinked home directory is enough, and macOS reaches every `mktemp` path that way through `/var` -> `private/var`. The mismatch misclassified an existing managed install as a foreign clone and would have built a second container beside the real one. The same defect class recurs whenever one side of a comparison is left unresolved — as it did with a curl install's `REPO_ROOT` and with the container path it was compared against. `resolve_dir` therefore echoes a missing path back rather than failing, so a not-yet-created container needs no per-call fallback and no site can compare against an empty path by forgetting one; callers that need "does not exist" test the directory explicitly. `git rev-parse --path-format=absolute` would do the same job but requires git 2.31+.

Before `current` is repointed, the installer rejects a staging path that resolves to the repository itself, enforcing the upgrade contract that the launcher never resolves to the master clone.

## Alternatives considered

**Make `~/.dsh/source/master` a symlink to the arbitrary clone.** Rejected. Git resolves the symlink and records the *real* path: a worktree created through it stores `gitdir: …/<clone>/.git/worktrees/<name>`, and `git worktree list` reports the clone. The symlink is therefore decorative — nothing reads it — while implying the container owns the repository. It also fails silently: moving the clone leaves `master` present but dangling and every staging worktree dead with `fatal: not a git repository`. Worst, it aliases two names onto one tree, so the "current must never be the master clone" check passes by string comparison while being false. `~/.dsh/source/master` is a location, not a name, and only the location is authoritative.

**Promote the checkout itself to the `current` target.** Rejected: the upgrade contract requires `current` to point to a clean staging worktree on a staging branch, never a feature, review, or detached checkout. It would also make every upgrade rewrite the tree the contributor is editing.

**Keep link-in-place behind a prompt or a `DSH_ADOPT` flag.** Rejected, and an earlier revision of this change shipped exactly that before it was removed. The second layout was the defect itself, so retaining it as an option preserves the problem and doubles the states every later change must handle — the prompt, the flag, the dirty-tree warning, and a second linking path all existed only to keep a layout nothing should produce. The original motivation for link-in-place, keeping the script testable against local source, survives adoption: a staging worktree branched from the checkout's `HEAD` runs the same code. `DSH_SOURCE` remains available for installing a separate tree.

**Warn or prompt when the tree is dirty.** Rejected: `worktree add` from `HEAD` cannot carry uncommitted work, so the behavior is determined and a prompt only adds a decision the user cannot act on differently. The contract is documented instead.

**Put an adopted clone's staging worktrees beside the clone** (`~/src/staging-*`) rather than in `~/.dsh/source`. Rejected: `current` and the PATH launcher are per-user singletons, so scattering worktrees across clone parents reintroduces the sibling-clone sprawl the source container exists to prevent.

## Consequences

One layout now serves every install, so an adopted clone is upgradable by `dsh-upgrade` without the one-time migration that skill described, and the installer has no branch that produces an unupgradable layout. In-repo runs still never mutate the working tree.

The cost is that a contributor can no longer point PATH at a checkout and have `dsh` follow that working tree as they switch branches: the launcher now resolves to a staging worktree pinned to the `HEAD` adopted at install time. Re-running the installer adopts the current `HEAD` again.

A container adopting an outside clone is also no longer self-contained: deleting that clone breaks its staging worktrees. This is inherent to reusing an existing clone rather than a property of this design — the rejected symlink hides it rather than fixing it — and git's own worktree records are what diagnose it.

## Testing

`scripts/install.sh` now has a real-shell PTY regression suite in `apps/cli/tests/install-script.spec.ts`, covering adoption and curl-style paths with stubbed dependencies. Curl-style installs default to the public `deepseek-ai/deepseek-harness-sdk` source, while replacing the installer with pnpm/npx remains separate work.

Verification was manual, through a throwaway harness driving the real script with a stubbed `pnpm`: adopting a standalone clone; adopting from a linked worktree into its existing container; an explicit `DSH_SOURCE` still opting back into cloning; a dirty tree adopting silently with no prompt or warning while its uncommitted file stays behind; a non-git checkout failing with guidance; and a `curl`-style clone install asserting the built layout, the check that catches an unresolved `REPO_ROOT`. The interactive path was exercised under tmux from a dirty checkout, confirming the run reaches the launcher with no adoption prompt and ends with `dsh` running from the new staging worktree while the original checkout keeps its branch and its uncommitted file.
