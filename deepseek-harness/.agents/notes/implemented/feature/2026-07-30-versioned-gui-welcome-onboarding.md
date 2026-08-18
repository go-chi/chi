# Agent Note: Versioned GUI welcome onboarding

Status: implemented

English | [中文](2026-07-30-versioned-gui-welcome-onboarding.zh.md)

## Problem

The GUI's credential onboarding begins with a DeepSeek-specific readiness check, but the internal-test notice applies to every user and must precede provider setup even when a credential is already configured. Treating both as independent overlays permits simultaneous dialogs, while a process-local dismissal cannot distinguish a completed notice from a window closed before acknowledgement or intentionally present revised copy once.

## Decision

**The Settings shell coordinates ordered steps.** `settings.onboarding` remains a root-scoped list, but `ui-settings` projects its entry ids and order into one coordinator and mounts only the first incomplete step. The active registrant receives `complete()` and `openSection(id)`; no later step mounts until ownership transfers. `ui-settings-models` now registers the restored welcome notice at order `-100` and the conditional DeepSeek credential step at order `0`; their current shared presentation is owned by the [shared-modal onboarding decision](2026-08-13-shared-modal-product-onboarding.md).

**The product welcome step is versioned and feature-owned.** The notice was historically removed by the [first-run beta notice removal](../simplification/2026-08-13-remove-first-run-beta-notice.md) and is now restored in `ui-settings-models` with new testing-stage copy. `ui-settings-general` still seats no onboarding step; the plugin that owns both current steps also owns the copy, store, and shared modal.

**The durable `ui-onboarding` section owns acknowledgement.** The Host half registers it in the user-settings seam under the active `$DSH_HOME/settings.yaml`; the current welcome store reads and writes `welcomeNoticeVersion` through the existing public settings API. The connection plugin publishes whether the current page uses a loopback authority as `ctx.connection.isLoopback`; hostname classification remains internal to the connection package, and other client plugins consume the service state instead of importing its implementation. The API proxy exposes this one product namespace through a closed allowlist beside configurable-provider namespaces, without treating its changes as model-catalog invalidations.

**Visible onboarding uses one shared modal contract.** Both current steps render through the same body-portaled `OnboardingModal`, and the underlying app root stays inert only while a dialog is visible. The shell renders no wrapper while a step loads its private facts. Explicit actions transfer coordinator ownership; Escape and mask clicks do not acknowledge or skip a step.

## Alternatives considered

**Browser local storage** — rejected because acknowledgement would follow one browser profile rather than `$DSH_HOME`; a fresh Harness profile could incorrectly inherit a prior acknowledgement, and external profile edits would have no authoritative update stream. Non-loopback fallback therefore remains process-local rather than browser-profile-local.

**A second independent modal in `ui-settings-general`** — rejected because list registrants would still stack whenever welcome and credential readiness were both true. Ordered ownership belongs to the shell that declares and renders the list.

**Persisting on render or window close** — rejected because observation is not acknowledgement and close delivery is unreliable. Only the explicit Continue commit may suppress the next launch.

**A generic public settings-exposure flag** — rejected because one product namespace does not justify widening every settings registrant's public configuration surface. The gateway keeps an explicit closed allowlist.

## Consequences

A fresh profile sees the current testing-stage notice, then the conditional DeepSeek key dialog when no provider is usable. Focused store and React tests pin exact-version acknowledgement, coordinator ordering, conditional transfer, shared modal behavior, and HMR cleanup. The real Chromium scenario boots the shipped Web composition with an isolated harness home, verifies both dialogs, writes the key through the existing credential boundary, and checks that no secret reaches the DOM, ARIA, or browser console.
