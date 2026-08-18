# Agent Note: TUI titles come from the session-title service

Status: implemented
Archived: 2026-07-27

English | [中文](2026-07-22-tui-titles-from-session-title-service.zh.md)

## Problem

A per-session title makes terminal panes and tabs distinguishable, but a TUI-local model call would create a second title pipeline beside [log-backed session titles](../feature/2026-07-21-log-backed-session-titles.md). The local path needs its own prompt, cap, one-shot latch, resume derivation, cancellation, and failure fallback, while its process-local result remains invisible to session listings, forks, Web consumers, and replay. If both paths run, one session can also be titled twice by different strategies.

## Decision

The session-title service is the one title source. The TUI contains no `autoTitle` config, title-model request, latch, abort controller, prompt, or output cap. It folds the latest logged title on mount (`foldSessionTitle`), renders it as the banner subtitle, and calls `runtime.terminal.setTitle` with `<session title> — <configured title>` on every accepted `session/title` event. The same terminal-safe OSC 0 path handles the configured fallback title, resumed sessions, and live revisions without renaming tmux windows or adding another terminal-control surface.

Model-made titles are a composition choice: `examples/tui-agent/cordis.yml` (and the scripted PTY fixture) mount `@deepseek-ai/dsh-session-title-first-message-llm`, which inherits the main request's route and replaces the spine's deterministic fallback with a short model summary. Deployments without the provider keep the fallback title from `dsh-agent-spine-demo`'s bundled `SessionTitleService`.

## Alternatives considered

**Keep both, letting the logged title win.** This was the first merge resolution: auto-title owned the whole window title until a logged `session/title` arrived in suffix form. It preserved behavior but doubled the model calls on every fresh session and left the TUI's title unobservable in the log, violating model-visible ⟺ logged in spirit and splitting the title contract across two owners.

**Port auto-title's prompt and cap into the service as a third provider.** The first-message-llm provider already exists with the same cadence, a reviewed prompt contract, durable request records, and supersession fencing; a second near-identical provider would be pure duplication.

**Use only a truncated first prompt or only a model title.** A deterministic fallback provides an immediate, free title, while an optional model provider improves quality without delaying the main turn. Forcing either strategy removes that deployment choice.

**Make model titles a TUI default or block the first turn for them.** The cost and route belong to composition, and auxiliary title latency must stay off the interaction critical path. The TUI consumes accepted state instead of owning generation policy.

**Rename a tmux window or use a separate terminal escape.** Rejected because the existing terminal adapter's OSC 0 path labels the pane or tab without acquiring tmux ownership or adding a second control API.

## Verification

TUI tests pin restored and live `session/title` consumption, terminal-safe title rendering, the configured fallback, and the absence of a TUI-owned model path. The keyless PTY smoke boots the real composition, accepts a logged provider title, and observes the resulting terminal title. The [log-backed title decision](../feature/2026-07-21-log-backed-session-titles.md) owns provider, persistence, resume, fork, cancellation, and stale-completion coverage.

## Consequences

One title pipeline is durable, replayable, visible to every consumer, and fenced against stale completions by the service. The TUI has no `llm`-streaming title path. Model quality requires a provider plugin in the composition, while deployments without one keep the deterministic fallback; the terminal title consistently uses the suffixed `<title> — <product>` shape.
