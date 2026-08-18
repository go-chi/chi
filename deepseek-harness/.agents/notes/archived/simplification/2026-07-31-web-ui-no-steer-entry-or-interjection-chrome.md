# Agent Note: Web UI drops steer entry and interjection chrome

Status: implemented
Archived: 2026-08-07

English | [中文](2026-07-31-web-ui-no-steer-entry-or-interjection-chrome.zh.md)

## Problem

Mid-turn steering is a host/agent-loop capability (`mode:'steer'`, a durable `user/message`). The Web product already locked the composer while a turn runs and never shipped a queue/steer menu, yet the client still threaded `'queue' | 'steer'` through the input machine, `conversation.send`, and locale keys, and rendered consumed steering as a badged 「插话」/「Interjection」 bubble. That left a half-built UI surface: an unused submit mode, a product label for a gesture users cannot perform, and e2e goldens that pinned chrome the product does not own.

## Decision

Keep host and runtime steering intact. Remove only the Web UI entry and chrome:

- `InputMachine` / `SessionInput` / `InputActions.submit` / hub `defaultSink` are queue-only; they always call `session.prompt(..., 'queue')`.
- `ConversationService.send(text)` drops its mode argument and always queues.
- Durable steer content renders as a plain right-aligned bubble (no badge, no user IconActions) so external/host steers stay visible on replay.
- Delete `message.steering` locale strings and the unused badge CSS.
- The web steering e2e still POSTs `mode:'steer'` over `/api/session.prompt` and asserts durable + model-visible obedience; it no longer expects interjection chrome. Update [web input machine note](../architecture/2026-07-25-web-input-machine-and-slash-pipeline.md) fact lines to match.

## Alternatives considered

**Delete host steering entirely.** Out of scope; the user asked only for Web UI display and entry. Agent-loop drain, session events, and the wire mode remain load-bearing for ACP/TUI/automation.

**Hide durable steer `user/message` content from the transcript.** Would lie on replay when an external client steers; rejected in favor of a plain bubble.

**Keep the mode parameter but only ever pass `'queue'`.** Leaves dead API surface and tests that invent `'steer'` paths the composer cannot reach.

## Consequences

- **Superseded in part.** Decision bullets 1 and 3 through 5 no longer describe master: composer steering shipped later, and the [context-source and steer marks decision](../feature/2026-08-04-web-context-source-and-steer-marks.md) owns its caption. The current facts follow.
- Host steering ownership is unchanged: agent-loop drain, session events, and the wire mode remain load-bearing for ACP, automation, and non-Web clients.
- `ConversationService.send(text)` still takes no mode and always queues; the composer's Steer gesture uses `session.prompt(mode: 'steer')` instead.
- Durable steer `user/message` content still folds into the transcript, so an externally submitted steer stays truthful on replay. It now carries the interjection caption instead of rendering as a bare bubble.
- Non-user next-step items (`agent.inject` context: approval notices, task completion, attached snapshots) broadcast with the `context` placement and never render as pending steering bubbles; they stay invisible until claimed as durable `user/message` context cards.

## Testing

- `packages/client/ui-conversation` unit/jsdom coverage: input machine enter/sink, ConversationService routing, the MessageItem steering arm, InputBar submit.
- `apps/web/tests/steering.e2e.ts` keyless replay plus its goldens, which pin the caption.
- `packages/host/apiproxy` `session/queue` projection test asserts user-origin next-step items stay `steering` while plugin-origin items land as `context`.
