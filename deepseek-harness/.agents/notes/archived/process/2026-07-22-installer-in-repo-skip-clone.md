# Agent Note: installer skips the clone when run from inside a checkout

Status: implemented
Archived: 2026-07-26

English | [中文](2026-07-22-installer-in-repo-skip-clone.zh.md)

## Problem

`scripts/install.sh` is written for the `curl ... | sh` path: it clones the harness into `~/.dsh/source`, then installs, links, and launches. Contributors who already have a checkout and run the same script directly (`sh scripts/install.sh`) got a second, unrelated clone at `~/.dsh/source` — installing and linking a different tree than the one they were working in, with no way to exercise the local script against the local source.

## Decision

The script detects when it is executing from inside a real checkout and, in that mode, reuses that checkout and skips the clone/update step entirely, leaving the working tree untouched.

Detection keys on `$0`: under `curl ... | sh` the script text arrives on stdin, so `$0` is the shell name and no file path resolves; running a checked-out copy makes `$0` the script file. When `$0` is a readable file whose parent is a `scripts/` directory inside a tree that carries both the `bin/dsh` launcher and `scripts/install.sh`, the script sets `IN_REPO=1` and repoints `DSH_SOURCE` at that repo root. Step 2 then prints a "using existing checkout" line and does nothing else — no `git fetch`, no `git checkout -B`, so the user's working tree and branch are never mutated. `DSH_REF` is advisory and ignored in this mode.

Explicit `DSH_SOURCE` wins over detection: the value is captured before defaulting, and in-repo detection only repoints an unset `DSH_SOURCE` (or one already equal to the detected repo root). Setting `DSH_SOURCE` to a different directory opts back into the normal clone/update path, so the escape hatch to install a separate tree from within a checkout still exists.

## Alternatives considered

**Detect via `git rev-parse --show-toplevel` on the current directory.** Rejected: `curl ... | sh` frequently runs from inside some unrelated git repo (the user's `cwd`), which would false-positive and skip the clone against a tree that is not dsh. Anchoring on `$0`'s own location ties the decision to where the script physically lives, and the `bin/dsh` + `scripts/install.sh` markers confirm it is actually a dsh checkout.

**Always skip the clone whenever run from a file, ignoring `DSH_SOURCE`.** Rejected: a contributor may legitimately run the in-repo script to provision a separate `~/.dsh/source` install; honoring an explicit `DSH_SOURCE` that differs from the checkout preserves that path.

## Consequences

Running `sh scripts/install.sh` from a checkout now installs, links, and launches that checkout instead of cloning a parallel one, which also makes the local script testable against local source. The cost is a detection block that couples to the repo layout (`scripts/` beside `bin/dsh`); if the launcher or script ever moves, the markers must move with it. The behavior is documented in the script header and both README files, and verified by running the four paths (in-repo skip, curl-style clone, explicit `DSH_SOURCE` elsewhere opting back in, explicit `DSH_SOURCE` equal to repo root still skipping).
