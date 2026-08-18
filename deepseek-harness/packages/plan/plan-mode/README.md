# @deepseek-ai/dsh-plan-mode

English | [中文](README.zh.md)

Logged, per-agent plan collaboration state with deployment-owned guidance, direct `/plan [message]` entry and `/plan off` exit commands, and the reviewed `exit_plan_mode` exit. Plan mode is soft guidance; sandbox mode and approval policy enforce restrictions independently and do not read or write plan state.

## Durable state

`plan/mode` (`{ active: boolean }`) is a log-only, whole-value-replace `SessionEventMap` member. `foldPlanMode(events)` returns the last logged value or `false`, so resume, fork, and compaction recover plan state directly from the session log. UIs observe committed flips through `session/event`.

`ctx.planMode.set(agent, active)` appends the standalone `plan/mode` event immediately when the agent is idle, because no in-turn pre-step runs before the next prompt. While the agent is running, it holds a pending selection for the next accepted in-turn pre-step. It returns which happened (`committed`/`queued`), a `cancelled` reversal, or a `noop`. `get(agent)` returns `{ active, pending? }`, separating the logged state used to assemble the current step from a user's mid-turn selection. Initial and continuation pre-steps both apply pending selections; a same-step request-recovery retry reuses its frozen assembly and leaves the selection pending for the next pre-step. A changed user selection contributes one plugin-sourced `user/message` notice when the last logged request header described the other state (both commit paths).

## Model and human interactions

While active, `plan:policy` renders the configured `section`. The plugin always registers `exit_plan_mode`, keeping tool schemas stable across the transition; its execute path accepts only active plan mode and leaves it only after an exact user approval through `ctx.userQuestions`.

The review question declares the `plan-review` presentation intent, naming `Approve` as the label that approves it, so a capable UI presents the plan as a decision instead of a generic question; the answer the tool reads is the same either way. A dismissed review — the user closing the request to speak instead — is reported to the model as such, telling it to stay in plan mode and wait for the message; every other review failure keeps the seam's own message.

When `ctx.commands` is composed, the package registers `/plan [message]` and reserves the exact argument `off` for direct exit. Bare `/plan` selects plan mode; any other non-empty argument selects it first and is then submitted through `agent.steer()`, so it becomes the next step's ordinary logged user message under plan guidance. `/plan off` selects inactive without sending model input; it also cancels a pending entry before plan mode reaches a request.

The Web client consumes the plugin-owned `/plan` command; other entry points may drive the same service directly without defining a second mode vocabulary.

## Session projection

When the composition mounts `ctx.sessionProjections` ([`@deepseek-ai/dsh-session-projection`](../../session/session-projection/README.md)), this package registers the `plan` projection unit under an injected child. The unit folds two event kinds: a `command/run` record named `plan` with recorded `args` sets the wanted target (`off` → inactive, anything else → active), and `plan/mode` commits the logged state and clears it; every other event returns the same state reference. `view` derives `{ active, pending }`, where `pending` is true only while an outstanding selection differs from the logged state — a pure replay quantity, so host restarts, other tabs, and cold reads all recover it from the log alone (the `/plan` handler calls `set()` before any failing path, so a failed handler cannot leave a recorded command without its plan selection). The key merges into `SessionProjectionMap` from `src/types.ts` (served to host consumers via `./types` and client aggregates via `./client`); the framework drives the unit and carriers serve the value on the history tail page and the `session/projection` push frame. Compositions without the registry are unaffected.

## Configuration

```yaml
- id: plan-mode
  name: '@deepseek-ai/dsh-plan-mode'
  config:
    section: |
      You are in plan mode. Explore and design before presenting the complete
      plan through exit_plan_mode.
```

`section` is required and non-empty. Unknown keys fail at load. The package does not accept arbitrary named modes, tool filters, sandbox settings, or approval policy.

Design: [plan-specific collaboration state](../../../.agents/notes/implemented/simplification/2026-07-22-plan-specific-collaboration-state.md).

## Model Experience

### Plan policy system prompt

#### What the model sees

While plan mode is active, the model sees the deployment's exact `section` text at prompt order 50; inactive mode contributes no text.

##### Configuration example

```markdown
You are in plan mode. Explore and design before presenting the complete plan through exit_plan_mode.
```

#### Token effect

Inactive mode adds no tokens; active mode adds the configured section to every request.

#### KV Cache effect

The section is stable within plan mode, but entering or leaving changes the system prompt from order 50 onward.

### Human command

#### What the model sees

`/plan`, `/plan off`, and their terminal results stay outside model history. A non-empty suffix other than the exact `off` argument becomes one trimmed user text block through `agent.steer()` after plan mode is selected. An active `/plan off` selection contributes the standard logged user-switch notice only when the last request header described plan mode; cancelling a pending entry contributes none because no request observed it.

#### Token effect

The optional message costs the same history tokens as submitting that text separately; bare `/plan` and `/plan off` add none. A narrated active exit adds the small retained switch notice.

#### KV Cache effect

The user block is append-only conversation growth. Entering or leaving plan mode changes the earlier policy section; a narrated exit notice is appended after the reusable request prefix.

### Exit tool schema and review exchange

#### What the model sees

The [`exit_plan_mode` schema](../../../docs/tool-catalog.md#deepseek-aidsh-plan-mode) remains available in both states; execution outside plan mode fails, while an approved in-mode review returns the canonical `{ approved: true }` value and renders the existing confirmation text. Rejection remains a failed call carrying review feedback, and a dismissed review a failed call naming the user's takeover.

#### Token effect

The stable schema is paid according to ToolRuntime mode, and each plan argument and review result remains in conversation history.

#### KV Cache effect

Mode transitions do not change the tool catalog; plan arguments and review results extend the conversation normally.

## Known Limitations and Deferred Work

- Plan mode guides rather than enforces; deployments that need enforced restrictions must configure sandbox and approval controls independently.
- A selection made after the turn's final accepted pre-step is lost if the process exits before another accepted in-turn pre-step, so the UI must reapply it.
- Forked agents inherit logged plan state, while newly spawned agents begin inactive; there is no creation-time plan option.
- A live child owned by another agent cannot open the `exit_plan_mode` review. The failed call tells the child to include the unresolved decision in its final result; durable fork lineage alone does not prevent a session resumed as a runtime root from opening the review.
- Only the Web UI has a specialized `plan-review` renderer; another interaction provider may present the same request through its generic option flow.
