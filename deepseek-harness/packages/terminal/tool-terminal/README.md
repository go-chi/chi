# @deepseek-ai/dsh-tool-terminal

English | [中文](README.zh.md)

Six model-facing tools over `ctx.terminals`: `terminal_open`, `terminal_send`, `terminal_read`, `terminal_signal`, `terminal_close`, and `terminal_list`. Every operation requires the exact initiating `Agent`, so a model cannot address another agent's terminal even if it learns the id.

`terminal_send(run_in_background: true)` reuses `ctx.jobs`; job preflight and the PTY service's exclusive per-session send reservation occur before the job id is returned, completion is collected with `job_output`, and `job_kill` delivers `SIGINT` to the foreground process group. Foreground sends use terminal call/result cards. Background sends use a generic execute card; open, read, signal, close, and list use generic `execute`, `read`, `execute`, `delete`, and `read` cards respectively. None declares source locations.

## Config

| key | default | meaning |
|---|---:|---|
| `enableRunInBackground` | `true` | expose and accept `run_in_background`; false omits the schema field and rejects a forced undeclared argument |
| `maxResultBytes` | `262144` | UTF-8 cap (minimum `64`) for each complete terminal result or PTY job output after wait, session, pagination, truncation, and task-status metadata |

Both values are validated at load. The minimum result cap keeps every registry-issued session or job id visible in its creation acknowledgement. When a result exceeds `maxResultBytes`, rendering reserves space for control metadata and a truncation marker when they fit; cuts preserve UTF-8 boundaries. Each terminal definition's final-content callback applies the same cap after normalized pre-, around-, and post-execute policy failures, denials, short-circuits, replacements, or blocks; a structured multi-block policy result retains its shape.

## Model Experience

### System prompt

#### What the model sees

The plugin contributes this fixed guidance section:

##### Terminal guidance

```markdown
Use a terminal session only when work needs persistent terminal state or interactive stdin; prefer shell/read/write/edit for bounded one-shot operations. Track every terminal session id and close sessions that no longer matter. An inferred_idle or timeout result does not prove the foreground command exited.
```

#### Token effect

Small fixed input cost on every request while the plugin is active.

#### KV Cache effect

Prefix-stable while the registration scope and guidance text are unchanged.

### Tool schemas

#### What the model sees

The six generated schemas are listed in the [`dsh-tool-terminal` catalog section](../../../docs/tool-catalog.md#deepseek-aidsh-tool-terminal). Their fixed schema tokens are present whenever this plugin is active; agent-scoped tool filtering may hide them.

#### Token effect

Fixed schema cost on requests where the tools are visible.

#### KV Cache effect

Prefix-stable while tool visibility and definitions are unchanged.

### Tool results and task context

#### What the model sees

Spawn returns the id and bounded MOTD. Send/read return bounded terminal text plus readiness/history markers. Background mode returns a generic job id. Every terminal-owned or policy-produced single-text result is capped by `maxResultBytes` after normalized tool or pipeline errors, denials, short-circuits, replacements, blocks, and generic job status text. Structured multi-block policy results retain their shape. Results remain in session history until compaction; incremental task reads do not repeat consumed output. Programmatic callers receive typed session snapshots, bounded provider read/send DTOs, signal and close outcomes, or `{ kind: "background", jobId }`; Native rendering applies the presentation cap above.

#### Token effect

Terminal-owned and policy-produced single-text results are data-dependent and bounded by `maxResultBytes`; a policy that deliberately substitutes structured multi-block content owns that content's bound. Each returned result remains in history until compaction.

#### KV Cache effect

Append-only; new results follow the reusable request prefix.

## Known Limitations and Deferred Work

- No named key sequence, TUI, BEL, resize, auto-start, or cross-agent sharing schema is exposed.
- Background mode requires both `@deepseek-ai/dsh-jobs` and its model-facing controller.
