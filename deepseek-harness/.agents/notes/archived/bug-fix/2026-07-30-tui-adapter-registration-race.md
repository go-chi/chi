# Agent Note: TUI model-context resolution defers on the adapter-registration race

Status: implemented
Archived: 2026-08-04

English | [中文](2026-07-30-tui-adapter-registration-race.zh.md)

## Problem

Cordis activates plugins by service availability, not configuration order, so the TUI (whose `inject` requires only the `llm` service) can mount before a configured adapter plugin such as `dsh-llm-pi-ai` finishes registering its provider routes. The TUI's model controller resolves the selected model's context window immediately on mount; when the agent's route pointed at a not-yet-registered provider, `resolveModelInfo` rejected with `NO_ADAPTER` and every fresh session printed `Could not resolve model context: no adapter registered for provider "…"` — a spurious error for a fully working configuration (the adapter registered milliseconds later, and chatting worked).

## Decision

The TUI model controller treats a `NO_ADAPTER` rejection of its context-window resolution as a transient state rather than an error: it parks the resolution silently and re-resolves on the next `llm/adapters-updated` commit — the payload-free registry notification `LlmService` already fires at every route commit point. A commit that still lacks the route parks the wait again, so unrelated topology changes stay silent. Any target change re-enters the resolution and clears the pending wait, so the deferred state can never go stale against the current selection; every other resolution error still prints the notice.

## Alternatives considered

**Have the TUI wait for boot to settle before resolving.** The TUI has no Loader dependency (tests and embedders run without one) and "settled" is not observable from inside a plugin; adding a Loader coupling for one cosmetic resolution inverts the dependency direction.

**Poll or retry with a timer.** A timer guesses at activation latency, still mis-prints on a slow adapter, and adds a tunable with no owner. The registry already announces every commit through `llm/adapters-updated`; subscribing is precise and free.

**Order the config so adapters load first.** Row order carries no load semantics in the Loader (activation is service-driven by design), so this cannot be expressed in configuration.

**Suppress NO_ADAPTER errors entirely.** A permanently missing adapter (typo in the provider name) would then never surface in the context-window path. Deferring keeps the signal: a wrong provider name still shows `model unset`-like behavior in the selector and fails loudly at dispatch, while the startup race resolves itself.

**Resolve the context window per submitted message instead of at mount.** The send path already resolves per step (`prepareCall()`), and the indicator is displayed continuously, not only when sending; per-submit display resolution would leave the indicator blank until the first message and re-run adapter I/O for a value that only changes on route changes.

## Consequences

A genuinely misconfigured provider no longer prints the context-resolution error at startup — it surfaces at first dispatch instead, which is where the failure is actionable. The controller subscribes to every `llm/adapters-updated` commit but acts only while a wait is parked; the listener's disposer is released by the channel's `detachListeners()` through the controller's `detach()`, symmetric with the sibling channel listeners. Covered by three TUI tests: the deferred resolution stays silent through an unrelated commit and completes when the route's commit arrives, a target change drops the stale wait, and after channel detach a registry commit no longer re-enters resolution.
