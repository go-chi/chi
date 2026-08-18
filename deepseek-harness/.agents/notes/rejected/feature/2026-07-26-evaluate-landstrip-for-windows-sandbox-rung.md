# Agent Note: Evaluate landstrip before building a Windows sandbox launcher

Status: rejected — landstrip is not battle-tested (a days-old single-maintainer project, ~48 GitHub stars at rejection); a security-invariant dependency must have proven adoption, so the win32 rung keeps the in-house-launcher plan

English | [中文](2026-07-26-evaluate-landstrip-for-windows-sandbox-rung.zh.md)

## Problem

The [sandbox decision](../../implemented/feature/2026-07-06-sandbox.md) leaves `PLATFORM_CHAINS.win32` empty and plans to fill it with "a confinement runner from the AppContainer/restricted-token family, shipped from its own repository on the `node-addon-landlock-run` template" — an estimated ~1,500-line new repo (the landlock-run subtree is ~1,460 lines of C/TS/scripts/tests plus docs and CI) authored and maintained in-house.

Since that note was written, a maintained third-party runner has appeared: `@landstrip/landstrip` (npm, actively developed, Rust core with prebuilt per-platform `optionalDependencies`) covers Landlock + seccomp on Linux, Seatbelt on macOS, and AppContainer/restricted-user on Windows, with JSON/YAML policy input and a trap-fd denial-reporting channel. It is exec-wrapped like bwrap, so it fits the chain's `confine(argv)` shape without touching the Linux/macOS rungs.

## Proposal

When the Windows sandbox phase is picked up, evaluate wrapping landstrip's Windows backend as the `win32` chain runner before authoring an in-house AppContainer launcher repository. The evaluation must answer:

- **Probe synthesis.** landstrip has no `--probe`; the chain's functional-probe contract would have to be synthesized from a trap run.
- **Dialect mapping.** Denial and runner-failure stderr dialects, and fail-closed exit-code classification, need explicit mapping into the chain's vocabulary.
- **License.** The binaries are LGPL-2.1-or-later; distribution review is required before it enters the shipped closure.
- **Source and build record.** Each in-house launcher binary is byte-pinned to a native CI build of a ~300-line reviewable C file; landstrip is a single-maintainer Rust binary set. For the *existing Linux rung* that trade is already settled — do not swap it ([sandbox note](../../implemented/feature/2026-07-06-sandbox.md) and the launcher's own migration away from a Rust dependency). For a rung we have not built, weighing third-party maintenance against a second in-house native repo is a genuinely open question.

## Alternatives considered

- **Build the in-house AppContainer launcher as planned.** Still the default if the evaluation fails on license, source/build auditability, or probe fit; the cost is owning a second native security launcher repo indefinitely.
- **Swap the Linux Landlock rung to landstrip too.** Rejected outright: sandbox correctness is a security invariant, the current launcher has reviewable C source and binaries byte-pinned to native CI builds, and it already migrated away from a Rust dependency for exactly this reason.

## Acceptance criteria

- Before any Windows-rung implementation starts, an evaluation records the probe, dialect, license, source repository, release process, and binary build answers, and the go/no-go is added to the sandbox note's deferred-phases plan.

## Risks

- Single-maintainer supply chain in a security-critical position — the reason this is an evaluation gate, not an adoption decision.
- The package is young; its API and packaging may churn before the Windows phase starts, so re-verify against the live registry then.
