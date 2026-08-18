# @deepseek-ai/dsh-hooks-codex

English | [中文](README.zh.md)

A cordis plugin that runs the supported subset of a user's existing **Codex** hook config on the harness's canonical interception points. The **Codex dialect** half of the hooks subsystem. The dialect-agnostic primitives come from [`@deepseek-ai/dsh-hook-protocol`](../hook-protocol/README.md); this bridge owns the Codex-shaped payloads, matcher mode, and decision mapping.

This bridge implements a deliberate subset of Codex's current hook protocol:

- **Five of ten hook points:** `PreToolUse`, `PostToolUse`, `SessionStart`, `UserPromptSubmit`, and `Stop`.
- **Regex-only matchers** (no literal fast path; the matcher is always an unanchored regex).
- **snake_case stdin payloads** with `turn_id`/`model` extras, written **without** a trailing newline.
- **No Codex plugin env injection and no config-time placeholder substitution** (the command still receives the executor's environment and runs through its shell).
- **No pre-tool approval or rewrite path** — a hook can block, but the bridge does not pre-approve or replace tool input.

A native cordis plugin could do everything this bridge does, more powerfully; the bridge exists only as a compatibility path for the mapped Codex subset (see [the interception extension-points Agent Note](../../../.agents/notes/implemented/feature/2026-06-30-interception-extension-points.md)).

## Config

```ts
import type { Config } from '@deepseek-ai/dsh-hooks-codex'
const config: Config = {
  configPath: '/path/to/.codex/hooks.json', // required
  model: 'deepseek-v4',                      // optional: stamped on every payload (Codex includes `model`)
  defaultTimeoutMs: 600_000,                 // optional: per-hook timeout when a hook sets none
  stderrSummaryMaxChars: 500,                // optional: char cap on the hook/result event's persisted stderr summary
}
```

In a `cordis.yml`:

```yaml
- dsh-hooks-codex:
    configPath: ./.codex/hooks.json
    model: deepseek-v4
```

The config is parsed **once** at load. `configPath` is **process-level** — a relative path resolves against the process launch cwd at load time, not per-session (`TODO(per-session-hook-config)`). A read/parse failure is contained (logs + registers nothing); an invalid regex matcher on an event that consumes matchers is one such failure and reports its pattern and event. Only sync `type: 'command'` hooks run — a non-command or `async: true` hook is parsed-and-skipped with a warning. A hook accepts `timeout` or the `timeoutSec` alias; one that sets neither runs under the protocol's reference default (`DEFAULT_HOOK_TIMEOUT_MS` from `dsh-hook-protocol`, 10 minutes). Events outside the five bridge-supported points are dropped at parse.

The hooks themselves run in the agent's session workspace: for the agent-scoped points the bridge passes the session's `cwd` as the hook process's working directory, so a hook operates in the user's project tree, not the server launch dir.

## Hook points → typed Decisions

| Codex hook | Harness point | Mapping |
|---|---|---|
| `SessionStart` | `agent/session-start` (emit) | a plain-stdout hook's output → additionalContext → `agent.inject()` |
| `UserPromptSubmit` | `agent/pre-step` (waterfall) | `block` (exit 2) → `PreStepDecision.reject`; additionalContext-only → delegate via `next()` then append a separately sourced message to a downstream `enter` decision |
| `PreToolUse` | `tools/pre-execute` (waterfall) | `block` → `PreToolDecision.deny` (no `allow`/`ask`) |
| `PostToolUse` | `tools/post-execute` (waterfall) | `block` → `block` with feedback; additionalContext-only → delegate via `next()` then prepend a separately sourced context to the downstream decision; Code Mode defers sub-call contexts until the outer `run_code` result |
| `Stop` | `agent/turn-stopping` (serial) | a blocking Stop hook feeds its reason through `steer()`, forcing another step |

A tool call's payload carries the real `tool_name` (the same value the matcher tests) and Codex's `tool_input: { command }` shape (the `command` arg when present, else `''`). The matcher subject is the tool name (`PreToolUse`/`PostToolUse`) or the session source (`SessionStart`); `UserPromptSubmit`/`Stop` ignore matchers.

Every agent-scoped stdin payload carries `session_id` and `transcript_path`. The bridge resolves the latter through `ctx.sessionPersistence.locate(session.header)` when available and otherwise sends `null`, preserving the Codex `string | null` shape. Lookup does not create or flush the artifact, so a path can be absent before the first turn-end checkpoint or omit the current open turn.

`SessionStart` — the one emit point — runs detached; each run chain is tracked, and disposing the bridge aborts a still-running hook process, then drains the continuation before the dispose resolves (`createDetachedRuns` in `dsh-hook-protocol`).

## Context source

Injected context carries an explicit `{ kind: 'plugin', plugin: 'hooks-codex' }` source so the durable message is never mistaken for a user prompt.

## Model Experience

### Hook-provided context

#### What the model sees

`SessionStart`, accepted prompt, and post-tool hooks can add source-attributed context messages; a blocking `Stop` hook adds its reason as next-step steering.

#### Token effect

No cost when hooks return no context. Hook text is data-dependent, logged, and resent until compaction.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Blocked prompt or tool outcome

#### What the model sees

Provider-supplied reasons pass through verbatim. When absent, a blocked prompt uses exactly `blocked by UserPromptSubmit hook`, a denied tool becomes `Error: blocked by PreToolUse hook`, blocked post-tool feedback is exactly `blocked by PostToolUse hook`, and a blocking stop adds steering exactly `continue: blocked by Stop hook`. Codex `systemMessage` is not surfaced.

#### Token effect

Blocking a prompt removes its request tokens; denial or feedback adds the retained fallback or provider text; forced continuation pays another full request.

#### KV Cache effect

A blocked prompt sends no request and invalidates nothing. Denial, feedback, and forced-continuation context append after the reusable prefix without rewriting it.

## Known Limitations and Deferred Work

- **Unsupported hook events (5 of Codex's current 10):** `PermissionRequest`, `PreCompact`, `PostCompact`, `SubagentStart`, and `SubagentStop`. Config for these events is silently dropped during parsing. The comparison baseline is Codex's [official hook reference](https://learn.chatgpt.com/docs/hooks).
- **`SessionStart` is partial:** plain stdout and JSON `additionalContext` work, but the hook runs detached, so context can miss the first request (`TODO(session-start-gating)`).
- **`UserPromptSubmit` is partial:** blocking plus plain-stdout or JSON context work, but the common `systemMessage` and `{"continue": false}` controls are not enforced.
- **`PreToolUse` is partial:** blocking works, but `additionalContext`, `permissionDecision: "allow"`, and `updatedInput` are ignored. Every tool is represented as `tool_input: { command }`, so non-shell tool arguments are not faithfully exposed to the hook.
- **`PostToolUse` is partial:** blocking feedback and JSON `additionalContext` work, but `{"continue": false}` is not enforced, non-shell tool arguments are reduced to `{ command }`, and structured tool output is flattened to text in `tool_response`.
- **`Stop` is partial:** blocking forces another model turn, but `stop_hook_active` is always `false`, `last_assistant_message` is always `null`, and `{"continue": false}` is not enforced. An unconditionally blocking hook therefore force-continues every step unless it self-limits (`TODO(stop-loop-guard)`).
- **Common payload and output fields are partial:** every mapped event reports the statically configured `model` and `permission_mode: "default"` instead of current Codex runtime values. `systemMessage` is logged + warned but not surfaced, and `{"continue": false}` is recorded but does not apply Codex's event-specific stop behavior (`TODO(hook-continue-false)`).
- **Config loading and execution are partial:** one process-level `configPath` is parsed at load; Codex's active user, project, session, system/managed, and plugin layers, trust controls, and inline `config.toml` hook form are not implemented (`TODO(per-session-hook-config)`). Only synchronous `command` handlers run, current metadata such as `statusMessage` and `commandWindows` is ignored, and matching handlers run serially rather than with Codex's concurrent launch semantics.
