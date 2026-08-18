# @deepseek-ai/dsh-command-compact

English | [中文](README.zh.md)

Human-facing `/compact` control over [`ctx.compaction`](../compaction/README.md). The plugin registers one global command through [`ctx.commands`](../../interaction/commands/README.md), so every composed command adapter discovers and executes it without a model turn. The [queued manual compaction Agent Note](../../../.agents/notes/implemented/feature/2026-07-30-queued-manual-compaction.md) owns the admission, lock, and durability decisions.

## Command contract

| Input | Result |
|---|---|
| `/compact` | Summarize one useful balanced older span even below automatic pressure, then report the replaced history-item count and estimated tokens after the standalone bracket is flushed. |
| `/compact` with no compactable history | `No compactable history yet.` — no marker or surface mutation is written. |
| `/compact <anything>` | `Usage: /compact (no arguments)` — the command takes no arguments and calls no compaction backend. |

The command is backend-independent: it depends only on `compactNow(agent, signal)`. The invoking agent is the exact target, and the dispatching UI's cancellation signal is forwarded through the seam. Every resolved invocation records the executor-owned log-only pair `command/run` / `command/done`; neither event joins model history. On success, `command/done.sourceEventSeq` names the transaction's `compaction/summary` event so a presentation can fold the command lifecycle into its checkpoint without parsing result text or assuming adjacent rows.

Expected `ManualCompactionError` codes become stable direct errors:

| Code | Direct result |
|---|---|
| `busy` | `Compaction is unavailable because this process has an active compaction, or the agent is not idle.` |
| `changed` | `The history selected for compaction changed before it could be replaced. The conversation is unchanged; the attempt is recorded in the session log.` |
| `summary` | `Compaction could not produce a useful summary. The conversation is unchanged; the attempt is recorded in the session log.` |
| `commit` | `Compaction did not finish cleanly; some session history may have changed. Inspect the current session state before retrying.` |
| `persistence` | `Compaction finished, but the session could not be saved.` |

The busy result is intentionally process-scoped: a live unmatched marker blocks, while a marker older than the newest `session/end-seed` is stale and does not. Unexpected implementation failures reject dispatch. Cancellation remains authoritative; the backend completes its required close/flush cleanup, and the command settles internally as `Compaction cancelled.` while the command executor stops waiting with its cancellation error. Plugin disposal first unregisters `/compact`, then drains every handler that already started, so root teardown cannot pass an aborted command's close or flush boundary.

Prompts submitted while compaction runs remain accepted in the agent's ordinary FIFO with the same identity and wakeup facts. They start only after the compaction's explicit durability checkpoint and admission release. Idle injected context is not held: it may be logged between `compaction/start` and `compaction/end`, and positional replacement leaves it visible after the checkpoint.

## Composition

The producer injects `commands` and `compact`. Mount the command registry, one backend, and this plugin:

```yaml
- id: commands
  name: '@deepseek-ai/dsh-commands'
- id: compaction-basic
  name: '@deepseek-ai/dsh-compaction-basic'
- id: command-compact
  name: '@deepseek-ai/dsh-command-compact'
```

The shipped `dsh` base mounts it beside `compaction-basic`, and the Web client provides the command adapter. Automation surfaces that compose no command adapter keep automatic compaction only.

## Model Experience

### Human `/compact` control

#### What the model sees

The slash input and direct result never enter a model request. An accepted compaction separately replaces an older span with the backend's user-role checkpoint inside a standalone `compaction/* { turn: null }` bracket.

#### Token effect

The command lifecycle adds no model tokens. A successful compaction reduces later requests by replacing the selected span with one framed summary; summarization itself is one auxiliary request.

#### KV Cache effect

Discovery and command bookkeeping do not affect the cache. The accepted surface replacement invalidates reuse from the first shadowed history token.

## Known Limitations and Deferred Work

- **Idle-only** — `/compact` reports `busy` when a turn or already accepted waking prompt has right of way; the command itself is not queued.
- **No range or policy arguments** — the argument-free form keeps behavior stable across command adapters. Explicit ranges remain the programmatic `compactRegion()` path.
- **Command adapters only** — surfaces without `ctx.commands` cannot invoke it and rely on automatic pressure compaction.
