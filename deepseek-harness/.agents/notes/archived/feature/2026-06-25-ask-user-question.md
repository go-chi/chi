# Agent Note: Ask-user question capability

Status: implemented
Archived: 2026-07-27

English | [中文](2026-06-25-ask-user-question.zh.md)

## Problem

The agent sometimes cannot proceed safely from model inference alone: it needs the human to choose a path, confirm a risky/default action, or provide missing information. Before this change, the only way to get that answer was for the model to ask in assistant text and then stop, which broke the normal tool-call loop: the agent had no structured way to pause, no option metadata for UIs, no abort/error taxonomy, and no way for non-stdio front doors to present the question consistently.

This is a user-facing capability, but it also crosses package boundaries. A model-facing tool needs a provider-neutral request vocabulary; each UI surface needs to decide how to show and collect the answer; the agent loop should remain unchanged because a tool call already has the right async shape.

## Decision

Introduce `dsh-user-interaction` as the provider-neutral interface package for `ctx.userInteraction`, colocated with the model-facing consumer `dsh-tool-ask-user` under `packages/ui`. The grouping is intentional: asking a human is a UI-backed product affordance, not part of the providerless core spine. The seam still owns the stable request/answer/error vocabulary, while UI product surfaces provide the concrete provider that collects the answer. The tool registers `ask_user_question`, forwards `{ questions, agent, signal }`, and returns the provider-computed structured answers as the tool result.

The model-facing request vocabulary is deliberately aligned with the product-research schema: `ask_user_question({ questions: [{ id, question, header?, options?: [{ label, description? }], multi_select? }] })`. `id` is supplied per question and echoed in the result so a batch can be routed without relying on question text. `label` is both user-facing display text and the selected value returned to the model; there is no separate `value`, no `recommended`, no `allow_custom`, and no `desc` alias.

Providers return `{ answers: [{ id, selected, custom? }] }`. `selected` is always an array of selected option labels, so single-select and `multi_select` answers share one result shape. `custom` carries a free-text "Other" answer; optionless questions collect `custom` directly. When `custom` is present, it overrides any selected choices and `selected` is empty. A provider that supports partial completion represents a deliberately skipped item with the existing `{ id, selected: [] }` shape, preserving the other answers without extending the tool result vocabulary.

`UserInteractionError` extends `HarnessError`, so failures such as `NO_PROVIDER`, `ASK_ABORTED`, or missing request ownership survive `ctx.tools.execute()` as machine-routable `{ name, code }` tool errors. This matches the structured-error taxonomy and lets the model or a wrapping plugin distinguish "user cancelled" from a generic thrown exception.

## UI mappings

`dsh web` mounts `dsh-client-ui-question`, whose host half opts the Web product into the model-facing tool and whose browser half registers a `question` entry in the conversation-owned keyed composer slot. `createApiProxy` implements the Web provider with a process-memory pending table keyed by a host-minted rpcId. It registers the wait before broadcasting `question/requested`, replays the same id on every mux reopen, validates the session and complete answer batch before claiming it, and broadcasts `question/resolved` after answer, cancellation, abort, or disposal. Claiming deletes the entry synchronously, so the first valid response wins and duplicate or late responses return `not-pending`.

The Web composer shows one question at a time while retaining every request in the session object layer. It supports single-select, multi-select, optionless or explicit custom answers, description text, and a visual recommendation badge without selecting the recommendation automatically. Single-select choices advance to the next item immediately, and Enter submits when every item is answered or explicitly skipped; Enter during IME composition only confirms the input candidate. The footer skips only the current item and preserves earlier drafts; the close control rejects the whole tool call with `ASK_CANCELLED`. The normal composer returns only after the host's resolved frame removes the pending item.

`dsh-tui` renders each question as a keyboard overlay, shows option descriptions, supports single- and multi-select choices plus free-form custom answers, and rejects pending questions on abort, provider disposal, or terminal shutdown. Batched and simultaneous requests are queued so one overlay owns keyboard focus at a time.

An ACP elicitation mapping existed while the bridge was an editor UI; [ACP as an automation-only protocol](../simplification/2026-07-23-acp-automation-only-protocol.md) removed that third mapping.

## Alternatives considered

**Assistant text followed by a stopped turn.** The model could ask the user in plain assistant text and then stop. That loses the structured option metadata, gives UIs no provider-neutral way to render a choice, and forces the next human answer to arrive as a new user prompt rather than as the result of the operation that needed the answer.

**Core-owned ask-user packages.** The first implementation split the seam and the model-facing tool across `packages/core` and `packages/ui`, but both names describe one UI-backed human-interaction affordance. The seam remains provider-neutral, but it is not providerless core infrastructure like sessions, tools, or the agent registry. Keeping `dsh-user-interaction` and `dsh-tool-ask-user` together under `packages/ui` makes the package map match the product boundary: apps and bridges provide the human-answer provider, and the stdio app opts into the model-facing tool.

**Use a permission request for general questions.** Permission requests authorize tool execution; `ask_user_question` gathers information with optional free-form answers. Reusing the permission channel would collapse two different product concepts.

**A loop-level pause primitive.** The agent loop already knows how to await a tool call and resume from a tool result. Adding a new loop special case would duplicate that async shape and make every loop implementation learn about a UI concern.

## Consequences

The feature gives the model a powerful pause primitive, so prompt guidance matters. The tool description tells the model to ask concise questions and use options when possible. Product policy can later wrap `tools/execute` to restrict when the tool is allowed, but the loop should not special-case it.

`dsh-user-interaction` and `dsh-tool-ask-user` both live in `packages/ui` because they form one product-facing human-interaction capability. `agent-core` does not load either the tool or a provider. `dsh-tui-demo` opts into the seam, TUI provider, and model-facing tool. `dsh web` boots the seam/provider in the host runtime and exposes the tool through the selected Web question plugin. The ACP automation app mounts neither the seam nor the tool.

## Testing

Unit coverage pins provider registration/disposal, duplicate-provider rejection, abort-before-provider, empty-question rejection, structured tool errors through `ctx.tools.execute()`, batched answers, multi-select answers, custom answers, explicit per-item skips, and the model schema including the removal of `value`, `recommended`, `allow_custom`, and `desc`. TUI tests cover option descriptions, queued requests, shutdown/abort cleanup, optionless free-form input, invalid choices, duplicate multi-select selections, and batched question flows. Web tests pin stable-id replay, response validation, first-wins settlement, duplicate and late responses, whole-request cancellation versus owner abort, single-select advance, IME-safe Enter submission, per-item skip preservation, composer takeover, structured batch submission, and restoration of the normal composer.
