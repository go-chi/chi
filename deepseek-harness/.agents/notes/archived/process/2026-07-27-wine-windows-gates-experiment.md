# Agent Note: Wine-run Windows blocking gates on Linux runners

Status: implemented
Archived: 2026-08-08

English | [中文](2026-07-27-wine-windows-gates-experiment.zh.md)

## Problem

The pull-request Windows lane exists to prove the two blocking win32 surfaces — the workspace build and the production site — and it ran on hosted `windows-2025`, the slowest job in the required matrix: 7–9 minutes against 1.5–2.5 for the Linux jobs, so the Windows VM's boot, setup, and filesystem costs dominated every pull request's critical path.

The question the experiment answered: can a plain Linux runner produce an equivalent win32 signal for the blocking surfaces at Linux wall clock, so no Windows VM sits on the pull-request path at all?

## Decision

The required pull-request `windows` job in [ci.yml](../../../../.github/workflows/ci.yml) (`windows node 24 / wine blocking`) runs the blocking gate commands on `ubuntu-latest` under Wine with real Windows binaries: a checksum-verified win-x64 Node.js executes `tsc -b`, `tsdown`, and the VitePress production build, so the win32 branches of the toolchain — backslash path handling, `CreateProcess` spawn semantics, PE loading of `@esbuild/win32-x64`, and the rolldown/rollup MSVC `.node` addons — actually execute. The master `serial-windows` job is untouched: the complete native-kernel inventory, including the observational portability gates this lane does not run, still executes on real `windows-2025` on every master push.

Dependencies install natively on Linux with `supportedArchitectures` extended to win32-x64, which materializes the Windows platform packages in the same store; the cmd-shim layer is bypassed by invoking each tool's JavaScript entrypoint directly, the same processes `run-gates` ultimately spawns. `nodeLinker: hoisted` is load-bearing, not stylistic: an independent prototype kept pnpm's default isolated layout — including a faithful offline Windows-pnpm re-install over a Linux-prefetched store — and Windows Node under Wine still could not resolve `@esbuild/win32-x64` or load the koffi prebuild through the isolated symlink chain, failing before any repository gate ran. A flat layout with real files is what makes the gates reachable at all; the prototype's checksum pinning is adopted, while its Windows-pnpm-installs-the-tree goal is explicitly given up (the install contract stays Linux-tested here).

The lane holds the wall clock of the Linux CI jobs through four levers: the master-refreshed pnpm store cache (restore-only, same key as the Linux jobs), Wine provisioning (apt install, Windows Node download, `wineboot`) running concurrently with `pnpm install`, the two blocking surfaces running concurrently — the same shape `run-gates` gives them on native Windows — and an apt-archive cache keyed on the runner image, seeded from master by the `wine apt cache` job so every pull request restores from the default-branch scope.

The gate logic lives in one script, [scripts/wine-windows-gates.sh](../../../../scripts/wine-windows-gates.sh): the ci.yml job provisions runner state (caches, apt Wine) and calls it, and the optional local gate `pnpm run check:windows-wine` runs the identical script on a developer machine that has Wine installed — one implementation, so local reproduction of a red CI lane needs no translation between environments. The local gate is a diagnosis tool, not a routine check: run it only when investigating a known Windows-related failure; CI owns the everyday win32 signal, and [dsh-pre-push-checks](../../../skills/dsh-pre-push-checks/SKILL.md) never selects it. The script never mutates the working tree: it snapshots tracked plus untracked-unignored files into a scratch directory, applies the Wine-specific pnpm overrides to the snapshot only, and installs there against the shared store; the Wine prefix and the checksum-verified Windows Node zip persist under `.cache/wine-windows/` so local reruns skip provisioning, with an offline fallback to the newest cached zip when nodejs.org is unreachable.

Five environment constraints shape CI and local execution, each found as a red run: Ubuntu's `wine64` package alone puts nothing on PATH (install `wine`, the dispatcher); Node under Wine cannot attach stdio to the caller's pipes (`Socket open EBADF` at bootstrap — every invocation routes stdio through a file); Wine does not realpath pnpm's isolated-layout Unix symlinks (the hoisted layout above); macOS Wine also exposes hoisted workspace links as ordinary directories, so the client test aggregate includes every package-local CSS module declaration instead of relying on project-reference realpaths; and Wine cannot create Windows symlinks (`ENOTSUP` from VitePress's `linkVue` — the `vue` link is laid down host-side before the gate).

## Measured results

Measured on 2026-07-27, warm caches, pull-request trigger, standard 2-core `ubuntu-latest`: 2m46s end-to-end — setup and cache restores ~17s, concurrent install+provision 33s, concurrent gates 110s — against 1.5–2.5 minutes for the Linux CI jobs and 7–9 minutes for the replaced `windows-2025` job. A cold-cache run pays roughly one extra minute. An 8-core benchmark leg was defined during the experiment but never left the restricted `dsh-ubuntu-*` pool's queue; the standard-runner number met the target, so no larger box is used.

## Alternatives considered

**Keep the hosted `windows-2025` pull-request job (status quo).** Nothing wrong with its signal, only its latency: 7–9 minutes for two build commands, the slowest required job in the matrix. It survives as the master serial reference, where completeness matters more than latency.

**A full Windows guest under QEMU/KVM inside the Linux runner.** Real NT kernel, so full fidelity including case-insensitive NTFS and ConPTY — but tens of minutes of image download and unattended install before the first gate runs (40m19s measured end-to-end on the sibling experiment branch `exp/kvm-windows-ci`). Promotable only with disk-image caching that pressures the Actions cache budget.

**Windows pnpm performing the install under Wine.** The higher-fidelity variant of this same idea: MinGit and pnpm staged into the prefix, a Linux prefetch filling the store, then `pnpm install --offline` run by Windows Node so the install contract itself executes as win32. It reached the install but not the gates — Wine's networking could not reach the registry directly, and the isolated `node_modules` layout defeated resolution of the Windows platform packages even after a clean offline install. This lane trades that fidelity away (hoisted layout, Linux-side install) to reach the gates; the two records are complementary halves of the same verdict.

**Filesystem-semantics lanes on Linux (casefolded ext4, filename lint).** Catches the highest-frequency Windows breakage class for near-zero cost but proves nothing about win32 binaries. Explored as the sibling experiment branch `exp/casefold-windows-ci`; complementary to, not competitive with, this lane.

**Windows containers.** Not possible: Windows containers require a Windows host kernel; a hosted Linux runner cannot run them.

**Dropping the Windows lane.** Rejected — win32 is a first-class product target: the koffi-backed DACL and durable-namespace modules, ConPTY-based PTY sessions, and Windows path policy all ship in `packages/`.

## Consequences

Every pull request's Windows verdict now arrives in Linux-job time on free standard capacity, and no Windows VM allocation sits on the pull-request critical path; `all checks passed` consumes the same `windows` job id it always did.

What the trade costs: Wine reimplements Win32 over a case-sensitive ext4 — NTFS case-insensitivity, real DACLs, ConPTY, and crash-durability semantics are not proved here, and the observational portability inventory (duplication, publint, node-next types, built-package invariants on win32) no longer runs on pull requests at all. The master `serial-windows` reference owns all of that: a Wine-green pull request can still fail the native-kernel master run, and that failure mode is accepted as post-merge. The lane also inherits Wine-specific divergences as permanent job structure — file-routed stdio, the host-side `vue` link, the hoisted layout — so a future toolchain change that depends on isolated-layout semantics or in-process symlink creation will surface here first as a Wine failure rather than a product failure, and triage must classify it as such. If Wine reds ever recur without product cause, the recorded fallback is reverting the `windows` job to the pre-Wine `windows-2025` definition preserved in git history.
