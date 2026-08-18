# Agent Note: dsh-tui chat channel module split

Status: implemented
Archived: 2026-08-04

English | [中文](2026-07-27-tui-chat-channel-module-split.zh.md)

## Problem

`packages/ui/tui/src/index.ts` had grown past 2000 lines. Most of it was one `createTuiChat` factory: a ~1600-line closure holding roughly forty mutable variables and as many nested closures. Model selection, the ask-user-question queue, and session resume were tangled into that single scope, so a reader could not follow any one concern without holding the whole file in their head, and unrelated edits collided. A prior pass had grouped `src/` into `components/`, `session/`, `extension/`, but the entry file itself and the loose top-level input files (`autocomplete.ts`, `file-autocomplete.ts`, `skill-invocation.ts`, `xml-tool-output.ts`) were untouched.

## Decision

The chat channel's cohesive sub-machines are extracted from `createTuiChat` into `src/chat/`, each a factory that takes an explicit dependency bundle instead of closing over the entry scope:

- `chat/model-command.ts` — `createModelController`: the queued `/model` command, the model+reasoning-effort selector overlay, and the selected model's context-window resolution. Owns the context-window cache that the prompt and status views read.
- `chat/questions.ts` — `createQuestionQueue`: the user-interaction provider and the one-at-a-time FIFO ask-user-question overlays.
- `chat/resume.ts` — `createResumeController`: the `/resume` selector, per-candidate summary reads, the pre-handoff preflight, the terminal handoff, and the durable resume-hint command.
- `chat/helpers.ts` — zero-state helpers (`formatCwd`, `gitBranch`, surface/tool-call derivations, session-reference cards), the `HintEditor`, and banner-reveal constants.
- `chat/channel.ts` — `ChatChannelDeps` (the collaborator surface every sub-controller shares) and `ChannelNotice` (mixed in by the controllers that report outcomes). Each `*Deps` extends these, so the shared surface has one definition.

`src/` is reorganized so `chat/` holds every chat-channel concern: the sub-controllers above plus the former input files and the former `session/` files (`timing.ts`, `tokens.ts`) all move under `chat/`. `xml-tool-output.ts` moves under `components/`. The host/process boundary interfaces (`TuiRuntime`, `TuiResumeHost`) move to `src/runtime.ts`. After the split `src/` is `chat/`, `components/`, `extension/`, and the top-level `index.ts` / `config.ts` / `prompt.ts` / `runtime.ts` / `invariant.ts`; `index.ts` drops from 2067 to ~1530 lines and now constructs and wires the three controllers.

The convention for a controller's dependency bundle: stable value collaborators (`ctx`, `resolved`, `palette`, `overlayManager`, and each controller's own services) are destructured once; the channel callbacks (`appendNotice`, `requestRender`, `isDisposed`, `agentStatus`) stay on `deps` so a controller always calls the channel's current implementation. `channel.ts`'s JSDoc states this rule.

## Alternatives considered

- **Free functions taking a shared mutable context object.** Rejected: it would re-expose the same forty-field grab-bag the split set out to remove, just under a parameter name.
- **Extracting the status/timing animation controller too.** Deferred: `runningStatus` is read directly by the prompt caret animation in `updatePromptValues`, so a controller boundary there would leak its internal state back through getters — a leaky seam for little gain. It stays inline in `index.ts`.

## Consequences

Each concern is now readable and testable in isolation, and the shared dependency surface is defined once instead of copied into three interfaces. The cost: `index.ts` constructs the controllers and threads the callback bundle, and the model controller is a `let` forward-reference (`updatePromptValues` closes over it, but it is built later once `appendNotice`/`overlayManager` exist), carrying one justified `prefer-const` disable and a deferred first paint.

## Testing

Behavior is unchanged: all existing package tests and TUI snapshots pass without re-recording, which is the contract for this refactor.
