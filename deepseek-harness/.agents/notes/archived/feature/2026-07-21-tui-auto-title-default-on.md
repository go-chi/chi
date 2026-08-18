# Agent Note: Auto-title on by default, re-derived on resume

Status: implemented
Archived: 2026-07-26

English | [中文](2026-07-21-tui-auto-title-default-on.zh.md)

> **Superseded** by the [session-title consolidation Agent Note](../simplification/2026-07-22-tui-titles-from-session-title-service.md): the TUI-local `autoTitle` generation is removed; titles come from the log-backed session-title service, and the terminal rename consumes `session/title` events.

## Problem

The [auto-title Agent Note](2026-07-21-tui-auto-pane-title.md) shipped `autoTitle` off by default and, on a resumed session, kept the static title because the first `user/message` was already logged. In use both choices defeated the feature's purpose. A per-session descriptive pane title is what makes one tmux pane or terminal tab distinguishable from the next; leaving it off by default means the product ships an inert feature that almost no user turns on, and skipping re-derivation on resume means a resumed session — exactly the long-lived session most worth labelling — falls back to the shared static string. The user asked for a descriptive per-session name to be the normal experience.

## Decision

- `autoTitle` defaults **on** (`z.boolean().default(true)`, mirrored by `resolveTuiConfig`'s `?? true`). A deployment with an `llm` service and an agent provider/model gets a model-made pane title on every session without opting in; one without them keeps the static title, so default-on is inert where the call cannot run.
- A **resumed** session re-derives the title on mount from its already-logged first `user/message`: `createTuiChat` scans `agent.session.events` for the first such event and feeds its text to the same one-shot `generateTitle`. The title is never persisted (the session header carries no title field), so it is always derived, never restored.
- The one-shot latch is now simply `titleSettled = !resolved.autoTitle`. The prior pre-settle-on-resume clause is gone: on resume `generateTitle` runs once from the stored first message and then latches, so a message that arrives *after* the resume does not re-title. A fresh session has no stored `user/message` at mount, so the resume scan is a no-op and the live `session/event` listener titles the first message instead.
- Everything else from the [auto-title Agent Note](2026-07-21-tui-auto-pane-title.md) stands unchanged: the OSC 0 `runtime.terminal.setTitle` path, the model-summary shape (two-to-five lowercase words, first non-empty line, 40-char cap), the fire-and-forget `ctx.llm.stream` call that never touches the session or transcript, the shutdown `AbortController`, and every failure fallback (empty reply, missing `llm`, missing provider/model, whitespace-only prompt).

## Alternatives considered

**Keep the feature off by default.** Rejected: this is a direct reversal of the [auto-title Agent Note](2026-07-21-tui-auto-pane-title.md)'s "default off" decision at the user's request. Off-by-default ships an inert feature; the descriptive name is only useful if it is the normal experience. The keyless-replay concern that motivated off-by-default is addressed by pinning `autoTitle: false` in the replay-backed snapshot scenarios rather than by suppressing it for every deployment.

**Persist the derived title in the session header.** Rejected: the header has no title field and adding one would make a terminal label into session metadata — the boundary the [auto-title Agent Note](2026-07-21-tui-auto-pane-title.md) already drew against the log-backed session-title work. Re-deriving from the stored first message costs one tool-less call on resume and keeps the label a pure function of the conversation.

**Re-derive on resume from the latest message instead of the first.** Rejected: the title summarises what the session is *about*, which its opening request captures; a mid-conversation message would make the pane label drift as the work moves on.

## Consequences

- A fresh session with a working `llm` now spends one extra tool-less model call by default (previously only when opted in); a resumed session spends one on mount. Deployments without an `llm` or provider/model are unaffected.
- The replay-backed `examples/tui-agent/tests/tui.snapshot.ts` must opt **out**: it pins `autoTitle: false`, because a default-on title request is not among the recorded turns and `installLlmReplay` fails loud on an unrecorded request. The unit `packages/ui/tui/tests/tui.snapshot.ts` needs no opt-out — it mounts no `llm` service, so `generateTitle` short-circuits and the default flip is inert there. The interactive `examples/tui-agent/cordis.yml` and the scripted PTY fixture already set `autoTitle: true`, so the keyless smoke's OSC 0 assertion is unchanged.
- `packages/ui/tui/tests/tui.spec.ts` pins the new defaults: the config-default test expects `autoTitle: true`; the disabled-path test now sets `autoTitle: false` explicitly; and the former "resumed session never fires" test is rewritten to assert re-derivation from the stored first message and that a later live message does not re-title. `docs/config-catalog.md` regenerates to "On by default".
