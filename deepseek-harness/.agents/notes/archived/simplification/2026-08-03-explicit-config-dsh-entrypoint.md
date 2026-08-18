# Agent Note: Explicit-config dsh entrypoint

Status: implemented
Archived: 2026-08-08

English | [中文](2026-08-03-explicit-config-dsh-entrypoint.zh.md)

## Problem

Bare `dsh` selected a product TUI implicitly. That made one command own terminal lifecycle, session identity and resume handoff, onboarding, source-workspace shortcuts, guided upgrade sessions, personal config watching, and a large app-level PTY and transcript snapshot suite. The default also hid the actual composition boundary: `--config` was an optional third layer over a TUI overlay rather than the deployment definition a raw launcher needs.

The shared base is intentionally neutral: it provides capabilities but creates no startup agent or interaction front door. A neutral base paired with an implicit application made raw config composition less explicit and kept product policy in the CLI rather than in the caller-selected overlay.

## Decision

Raw executable use is `dsh --config <path>`. The named file must be an Include patch list and is applied directly over `apps/cli/config/base.cordis.yml` at the same include level. It is required for boot, is not a complete replacement tree, and does not inherit `apps/cli/config/web.cordis.yml` or `$DSH_HOME/config.yaml`. Relative paths resolve from the invoking directory. Boot errors fail loud; SIGINT and SIGTERM dispose the root before exit.

The raw diagnostic forms remain boot-free: `dsh --dump-default-config` prints the base, while `dsh --config <path> --dump-config` prints base plus the required overlay. The dump uses the Include implementation's patch algorithm and YAML dialect.

The CLI no longer ships a TUI application. Its TUI overlay, launcher, first-run onboarding assets, app-level TUI fixtures, PTY harness, terminal journeys, and snapshots are deleted. The `meta` and `upgrade` subcommands, their experimental gate, default-surface resume, and full-tree `--config-replace` path are deleted with that application. The installer builds and launches Web without an interface selector.

`dsh web` retains the shared base plus Web overlay and personal-or-explicit user layer. `dsh -p` retains the one-shot Web/headless composition. The reusable TUI package initially remained after this entrypoint change, then [the package-wide removal decision](2026-08-04-remove-tui-package.md) deleted it and its SDK interface.

This decision supersedes the `dsh`-specific parts of the [dedicated TUI front door](../../archived/feature/2026-07-17-dedicated-full-screen-tui-front-door.md), [personal config](../feature/2026-07-20-dsh-cli-personal-config.md), [guided skill commands](../../archived/feature/2026-07-28-dsh-guided-skill-session-commands.md), [meta workspace](../../archived/feature/2026-07-28-dsh-meta-source-workspace.md), [shared config overlays](2026-07-29-shared-base-config-overlays.md), [config dump](../../archived/feature/2026-07-30-dsh-dump-config.md), [first-run welcome](../../archived/feature/2026-07-30-versioned-tui-first-run-welcome.md), and [experimental subcommand gate](../../archived/feature/2026-07-31-experimental-subcommand-gate.md) notes. The later [package-wide removal decision](2026-08-04-remove-tui-package.md) supersedes their reusable-package decisions and consolidates the deleted launcher-identity record.

## Verification

Parser tests require `--config` for raw boot and reject the removed command names and incompatible option combinations. Built-bin acceptance runs the published JavaScript entry without tsx, checks base-only and base-plus-overlay dumps, and drives an invalid raw provider overlay to prove a boot failure settles and exits rather than hanging. Source-launch compatibility checks the same required-config diagnostic through `bin/dsh`. No `apps/cli` TUI demo or test remains.

## Alternatives considered

**Keep bare `dsh` as a TUI and add an explicit config subcommand.** Rejected because the CLI would still own two unrelated application policies and retain the TUI-only launcher, onboarding, and test infrastructure.

**Allow bare `dsh` to boot the neutral base.** Rejected because the base creates no agent or interaction front door. A process that settles successfully but has no usable entry point hides a missing deployment decision.

**Keep `--config-replace` for complete trees.** Rejected because raw execution now has one composition contract: a required overlay over the product base. Complete-tree deployments can use the generic Cordis loader or a dedicated application bin without adding a second meaning to `dsh --config`.

**Delete the TUI package with the product entrypoint.** Initially rejected because removing one shipped application did not by itself require removing a reusable UI implementation. Once no shipped composition or independent consumer remained, [the package-wide removal decision](2026-08-04-remove-tui-package.md) accepted this alternative.

## Consequences

Invoking `dsh` without a mode or raw config is a usage error. Existing TUI startup, `meta`, `upgrade`, resume, and full-tree replacement invocations stop working without compatibility aliases. This is acceptable under the pre-release compatibility stance and keeps the supported grammar small.

Raw deployments must state their agent and front-door rows in an overlay, which makes the application boundary reviewable and keeps base updates available underneath. They do not receive personal config implicitly; deployments that want that policy must compose it themselves. Web remains the installed interactive product surface, while headless and automation entries remain separate.

Reintroducing a shipped terminal application requires a concrete product need, a named entry mode rather than an implicit raw default, and its own current snapshot and lifecycle acceptance surface.
