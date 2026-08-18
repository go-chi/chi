# Agent Note: Required CI gate for web browser expected outputs

Status: implemented

English | [中文](2026-07-30-web-browser-snapshot-ci-gate.zh.md)

## Problem

The [keyless web browser e2e lane](2026-07-24-web-gui-browser-e2e-lane.md) runs only under the local `pnpm run test:web` command, and PR CI does not compare `apps/web/tests/snapshots/**/*.expected.md`. A PR that changes user-visible web output can therefore remain green when its expected outputs are not refreshed; when any later branch explicitly runs `DSH_SNAPSHOT=refresh`, it backfills the earlier change and produces a diff unrelated to that branch. Ordinary local runs already default to read-only replay, so the gap is mandatory enforcement at the PR level, not a ban on writes in refresh mode.

## Decision

For Linux PRs, the `node 24 / snapshots and artifacts` job must run the full web browser replay/compare suite. `scripts/run-gates.ts` registers `test:web:built` as a `ci-consumers` gate and explicitly injects `DSH_SNAPSHOT=replay`; CI never runs in `record` or `refresh` mode, so when the committed goldens disagree with the currently assembled application, the tests fail directly instead of silently rewriting them on the runner and then passing.

The consumer job owns the [single Linux build](../process/2026-07-30-independent-ci-consumer-build.md), so `apps/web/dist` and the package `lib/` directories remain in its workspace for the browser suite. On hosted runners, CI installs Chromium and its system dependencies at the Playwright version in the lockfile. On the persistent failover VM, the image owns the Linux system packages and CI installs only Chromium, avoiding per-run `apt` mutation. The hosted default-branch Linux serial job runs the suite and produces the operating-system-and-lockfile-keyed browser cache; pull requests restore it without paying compression and upload on the required path, with an operating-system prefix fallback across lockfile changes. The self-hosted standby runs the same comparison without hosted cache actions.

Local `pnpm run test:web` continues to build first and then run the full browser suite; `test:web:built` is the entry point for existing build artifacts. Developers explicitly run `DSH_SNAPSHOT=refresh pnpm run test:web` only after confirming that user-visible output changed intentionally, review every expected-output diff, and then verify again in replay mode that no files are written.

For pull requests, the gate runs only in the Linux consumer job: these scenarios target POSIX, and the other PR jobs do not provision Chromium. The hosted and self-hosted default-branch Linux serial aggregates also include the comparison, while the macOS and Windows serial jobs remain browser-free. A PR's `all checks passed` verdict already depends on the consumer job, so a browser compare failure blocks the merge without requiring a new branch-protection check name.

An observed self-hosted consumer run measured `web-snapshot` at 112.15 seconds and the full consumer aggregate at 114.97 seconds. The gate scheduler starts it as soon as `built-package-invariants` succeeds and runs independent gates concurrently, so it needs neither a dedicated job timeout nor a manual YAML ordering rule.

## Alternatives considered

**Continue requiring only local runs.** Rejected: execution depends on developer memory, which is precisely why stale goldens drift across PRs, and cannot guarantee that the PR introducing a behavior change carries its own expected-output diff.

**Run CI in `refresh` mode and then check the working tree.** Rejected: checking after writing turns the assertion mechanism into a generator; if the working-tree check is wired incorrectly, it can turn a regression into a passing expected-output update. Replay compares the existing goldens directly and has a smaller failure surface.

**Create a standalone browser job and rebuild the entire repository.** Rejected: it would duplicate dependency installation and the publishable build. The existing Linux consumer job already owns that build and is part of the unified required verdict.

**Replace real Chromium with jsdom snapshots.** Rejected: jsdom does not cover the browser, HTTP/SSE carriage, or the composition of real client plugin bundles. It remains useful for fast lower-layer feedback, but cannot replace the assembled browser chain.

## Consequences

Before merge, every PR proves that the current web assembly matches all committed browser expected outputs, turning a missed refresh from an “unrelated change in a later PR” into a failure in the PR that introduced it. The cost is Chromium provisioning and one serial pass through the browser scenarios in the consumer job; the consumer-owned build and browser cache avoid duplicate builds and downloads on reruns. The gate still makes no claim of cross-platform browser consistency, and if a Playwright/Chromium upgrade changes the ARIA format, the upgrade PR must explicitly refresh the expected outputs and review the churn.
