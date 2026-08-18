# @deepseek-ai/dsh-command-goal

English | [中文](README.zh.md)

Human-facing `/goal` control over [`ctx.goals`](../goal/README.md). The plugin registers one global command through [`ctx.commands`](../../interaction/commands/README.md), so every composed command adapter discovers and executes it without a model turn. The [human goal-command Agent Note](../../../.agents/notes/implemented/feature/2026-07-19-human-goal-command.md) owns the UX and composition decisions.

## Command contract

| Input | Result |
|---|---|
| `/goal` | Show the current objective, durable phase, round count/cap, process-local activation, and valid next commands; a blocked goal also shows its policy code and explanation, while no goal shows usage. |
| `/goal <objective>` | Create and arm a goal, or replace a completed goal with a fresh identity. An unfinished goal is never replaced without an explicit clear. |
| `/goal edit <objective>` | Edit the current objective without changing its phase or activation. Editing a completed goal creates a fresh active goal. |
| `/goal pause` | Pause an active goal and disarm continuation. |
| `/goal resume` | Resume a stopped goal or rearm an active goal after session resume/fork, subject to its remaining round cap. |
| `/goal clear` | Clear the current pointer while retaining its durable history and tombstone. |

Control words are case-insensitive only when they occupy the complete input. Every other non-empty suffix is an objective, so `/goal pause after verification` creates that literal objective. The goal domain trims and validates objectives. Because the generic command plane has no modal editor or confirmation primitive, `edit` takes its replacement inline and an unfinished replacement returns a direct error instructing the user to edit or clear.

Expected domain rejections become stable direct command errors without exposing branded ids or revisions. Unexpected implementation failures still reject dispatch so adapters can report them as command failures. Generic command text and output remain live UI state; `dsh-goal` persists every accepted mutation through its own durable `goal/change` event.

## Composition

The producer injects `commands` and `goals`. A custom app mounts their owners plus this plugin; automatic continuation remains an independent choice:

```yaml
- id: commands
  name: '@deepseek-ai/dsh-commands'
- id: goal
  name: '@deepseek-ai/dsh-goal'
- id: command-goal
  name: '@deepseek-ai/dsh-command-goal'
```

The shipped `dsh` base enables the persisted-goal stack and this command; the Web client provides its interactive adapter. The ACP automation app enables the domain and model tools without a command adapter; `goals: false` removes that stack. The UI-less `agent-spine-demo` requires an explicit `goals: {}` so headless one-shot callers do not silently change from one physical turn to a multi-round operation.

## Model Experience

### Human `/goal` control

#### What the model sees

The slash input, mutation, and direct status/error output are absent from model requests. The goal domain records the mutation as `goal/change`; an enabled same-session driver may expose the resulting state in a later continuation prompt. Presentation text is never logged.

#### Token effect

Reading status, mutating a goal, or receiving a direct command error adds no model tokens. An enabled same-session driver may add later goal-round prompts.

#### KV Cache effect

Command discovery, mutations, and direct output do not affect the cache. Later continuation prompts follow the driver's ordinary request history.

## Known Limitations and Deferred Work

- **Plain-text interaction only** — the generic command registry has no modal edit form or replacement-confirmation callback; inline edit and explicit clear keep destructive intent deterministic across adapters.
- **No per-command round-cap argument** — `defaultMaxGoalRounds` remains deployment config, while a direct human request may ask the model to edit `max_goal_rounds` through the separately authorized goal tool.
- **No continuous status widget** — bare `/goal` is the portable observation API; adapter-specific badges and reconnectable command output remain future UI work.
- **Web command adapter only in the shipped apps** — headless, ACP automation, and JSON-RPC adapters do not consume `ctx.commands`. Ordinary prompts can still authorize model-facing goal tools when those are composed.
