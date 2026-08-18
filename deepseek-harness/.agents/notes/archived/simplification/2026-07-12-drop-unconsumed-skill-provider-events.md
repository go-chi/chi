# Agent Note: Drop unconsumed skill provider events

Status: implemented
Archived: 2026-07-26

English | [中文](2026-07-12-drop-unconsumed-skill-provider-events.zh.md)

## Problem

Two skill-registry notifications are produced but have no production listener. The generated producer/consumer matrix and exact event-name searches find only declarations, emit sites, tests, generated catalogs, and prose for `skill/provider-added` and `skill/provider-removed`.

Skill discovery reads the current provider map on demand, provider registration synchronously clears completed catalogs, and the post-await revision check prevents stale discovery from entering the cache. No sibling plugin waits for a skill provider through these events, unlike the live `subagent/provider-added` consumer that tolerates concurrent sibling loading.

`tools/change` and `system-prompt/change` are explicitly outside this proposal. Existing simplification decisions retain them as intentional observation points for live tool and prompt UIs, and self-referential mounted plugins already use `tools/change`. This proposal also leaves `subagent/provider-added`/`removed` unchanged because `tool-subagent` has a production lifecycle consumer.

## Decision

The skill registry declares and emits no provider-membership events. Provider registration and disposal remain direct effect-owned state changes that synchronously invalidate completed catalogs; lookup and discovery read the current provider map on demand. Tests observe cleanup through provider lookup and collected output rather than lifecycle notifications.

The generated event catalog, API catalog, and producer/consumer matrix omit the deleted notifications. The skill-system Agent Note and package documentation describe registration through its direct effect-owned state and cache-invalidation contract.

## Alternatives considered

**Keep skill-provider notifications for future plugins.** A third-party plugin could observe provider availability, but direct provider registration and on-demand lookup are the extension contract; no current consumer needs a push signal. If a future sibling-load race appears, it can introduce a notification with the identity and readiness semantics that consumer requires, as the subagent registry did.

## Consequences

The generated event matrix contains no row for `skill/provider-added` or `skill/provider-removed`. Skill discovery, direct runtime registration, provider effect rollback/disposal, cache invalidation, and registry lookup cleanup remain; listener-triggered rollback disappears with the events. `tools/change`, `system-prompt/change`, and the consumed subagent provider lifecycle events are unchanged.

Pre-release consumers lose skill-provider observation points while retaining both ways to contribute skills: direct runtime registration and provider registration. A future consumer that needs live provider availability must add a purpose-built notification with the identity and readiness semantics it actually requires.
