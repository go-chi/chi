# @deepseek-ai/dsh-tool-todo

English | [中文](README.zh.md)

The model-facing `todo_write` tool: the agent's whole task list, replaced wholesale on each call.

## What it does

Registers one tool, `todo_write(todos: [{ content, status }])`, on `ctx.tools`. The model sends the ENTIRE list every call — there are no partial updates or per-item edits. Each call appends a `todo/write` event (the full list snapshot) to the calling agent's session log via `agent.session.append('todo/write', { todos })`; the current list is the most recent such event (last-write-wins on replay).

`status` is one of `pending`, `in_progress`, or `completed`.

## Single owner

The list belongs to the ONE agent session that called the tool. There is no subagent/shared/swarm scope: a non-agent caller (no `exec.agent`) has nowhere to write the list and is rejected. This is a deliberate scope limit — see the Agent Note.

## Configuration

`allowParallelInProgress` is required: every composition must choose whether several todos may be `in_progress` at once. It is a deployment choice, not a fixed rule: whether concurrent active tasks are legitimate depends on runtime concurrency the tool cannot observe. Use `true` for agents that may fan out work and `false` to enforce the single-active discipline.

The flag moves the model-facing instruction and the accepted input together — `true` asks the model to mark every actively worked task and accepts any number, `false` asks for exactly one and rejects a call marking more with `Error: invalid todos: at most one task may be in_progress (got <n>)`. The durable-log invariant does NOT follow it: a log written while parallel work was allowed must still replay after a deployment tightens the policy, so the invariant stays silent on the active count.

## Validation

Beyond the schema's type/required/enum checks, `execute` rejects an empty or duplicate `content`, and any item key beyond `content`/`status` — an extended item shape (ids, nesting) fails loud instead of silently flattening, keeping the logged snapshot equal to what the model believes it wrote. How many tasks may be `in_progress` at once is the deployment's call (§ Configuration): a composition that chooses `true` permits parallel work (concurrent subagents, background commands) to mark several tasks simultaneously. Ordering and the discipline of keeping the list current are left to the model via the tool description.

## Rendering

The canonical result is `{ todos, counts: { pending, inProgress, completed } }`; its Native renderer returns the compact update acknowledgement. The tool also writes the full `todo/write` session event. UIs subscribe to the event stream and render that durable list themselves: the [web client](../../client/ui-conversation) shows a plan strip plus a dedicated tool row off the standing plan — latest `todo/write` with no later `turn/start` ([display](../../../.agents/notes/implemented/feature/2026-07-23-web-todo-display.md), [lifetime](../../../.agents/notes/implemented/feature/2026-07-28-todo-plan-clears-on-next-turn.md)).

## Session projection

When the composition mounts `ctx.sessionProjections` ([`@deepseek-ai/dsh-session-projection`](../../session/session-projection/README.md)), this package registers the `todos` projection unit under an injected child: `init` = `null` (no write yet), `apply` = take the whole list from each `todo/write` and clear to `null` on each `turn/start` (standing plan; `turn/end` keeps the finished checklist; every other event returns the same state reference), `view` = identity, `stateVersion` = 2. The key merges into `SessionProjectionMap` here (via the Service Definition package's `/types` outlet); the framework drives the unit and carriers serve the value on the history tail page and the `session/projection` push frame. Compositions without the registry are unaffected. Lifetime rationale: [todo plan clears on next turn](../../../.agents/notes/implemented/feature/2026-07-28-todo-plan-clears-on-next-turn.md).

## Export shape

A function/namespace plugin: it exports `name` / `inject` / `apply` and NO default. A stray `export default` would collapse the module via the Loader's `unwrapExports` and drop `inject` (see [docs/postmortem/0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.md)).

## Model Experience

### Tool schema

#### What the model sees

The model sees the generated [`todo_write` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-todo).

#### Token effect

Fixed schema cost on every request where the tool is visible.

#### KV Cache effect

Prefix-stable while the definition and visibility are unchanged. Plugin lifecycle or scoped restrictions may invalidate reuse from this schema.

### Tool-call history and result

#### What the model sees

Each assistant tool call retains the entire replacement list in its arguments. Success returns exactly `Updated todo list: <pending> pending, <inProgress> in progress, <completed> completed.` Stable failures are ``Error: invalid todo: `content` must be a non-empty string``, `Error: invalid todos: duplicate content "<content>"`, `Error: todo_write requires an owning agent session`, and — only where the deployment set `allowParallelInProgress: false` — `Error: invalid todos: at most one task may be in_progress (got <n>)`. The full `todo/write` session event is UI and replay state, not a second model message.

#### Token effect

Token growth scales with every full list the model submits, and those call arguments remain until compaction. The result itself is small and fixed-shape.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **Single-owner scope only** — the list belongs to the one calling agent session; subagent/shared/swarm scopes are a deliberate cut (see § Single owner), and a non-agent caller is rejected.
- **The item shape is deliberately minimal** — `content` plus three-state `status`; whole-list replacement needs no stable id, priority, or active-form fields.
- **Whole-list replacement is the only operation** — no partial updates, no read-back tool; the model must resend the entire list each call.
