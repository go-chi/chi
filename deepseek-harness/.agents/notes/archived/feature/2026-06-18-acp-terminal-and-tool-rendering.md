# Agent Note: Rich ACP bash rendering — the terminal card via the `_meta` convention

Status: implemented
Archived: 2026-07-26

English | [中文](2026-06-18-acp-terminal-and-tool-rendering.zh.md)

> Superseded for ACP by [ACP as an automation-only protocol](../simplification/2026-07-23-acp-automation-only-protocol.md). Tool render intents remain available to UI transports, but ACP no longer projects them into terminal cards.

## Problem

The ACP bridge lets each tool own its call rendering via `presentCall`/`presentResult` (see [tool-call UI presentation](2026-06-14-acp-agent-client-protocol.md) and `packages/core/tools`). For `bash` we surface the exact command as the `tool_call` title, the model's `description` as a content text block, `kind: 'execute'`, and the completed output wrapped in a fenced ` ```console ` text block.

Reference editors render terminal metadata as a dedicated card with cwd, command, live-style output, and exit status; plain text loses that structure. The command is the title because execute cards hide raw input, while the human-readable description remains a separate block above the card.

## Key finding: agent-executed terminals use a `_meta` convention, NOT `terminal/create`

The ACP spec has a *client-side* terminal sub-protocol — the agent calls the client's `terminal/create` with `{ command, args, cwd, env }` and the **editor** executes the process, then the agent reads `terminal/output` / `wait_for_exit`. That model is wrong for us: our harness executes bash itself through `dsh-bash` (sandboxed env-scrub, background-task ownership, per-session cwd). Routing execution to the editor would bypass all of that and fork execution into two backends.

Studying the two reference agents (2026-06-18) shows neither uses `terminal/create` for their own shell tool — **both keep agent-side execution and emit a `_meta` convention** that Zed special-cases:

- **`claude-agent-acp`** (`tools.ts`, `acp-agent.ts`): gated on `clientCapabilities._meta.terminal_output`. The `tool_call` carries `content: [{ type: 'terminal', terminalId }]` and `_meta.terminal_info.{ terminal_id, cwd }`; output/exit arrive on the `tool_call_update`'s `_meta.terminal_output.{ terminal_id, data }` and `_meta.terminal_exit.{ terminal_id, exit_code, signal }`.
- **`codex-acp`** (`CodexToolCallMapper.ts`, `TerminalOutputMode.ts`): same `terminal_info` on the call; output via `_meta.terminal_output` (full) or `_meta.terminal_output_delta` (incremental), selected from the same `_meta.terminal_output` capability.

Zed's side (`crates/agent_servers/src/acp.rs`, verified): on a `ToolCall` whose `_meta.terminal_info.terminal_id` is set, it registers a **display-only** terminal (header = `terminal_info.cwd`, label = `tool_call.title`); on a `ToolCallUpdate`, `_meta.terminal_output.data` writes to that terminal and `_meta.terminal_exit.{exit_code,signal}` sets the status. It advertises the capability as `clientCapabilities._meta.terminal_output = true`. `_meta` itself is a spec-blessed ACP extensibility point (typed `{[k]: unknown} | null` on `ToolCall`/`ToolCallUpdate`); the *specific keys* here (`terminal_info`/`terminal_output`/`terminal_exit`) are a Zed convention, not part of the ACP spec — but they are the de-facto contract for the Zed integration and the only way to get the terminal card while keeping execution agent-side.

## Decision

Keep `dsh-bash` agent-side execution; render the terminal card via the `_meta` convention, capability-gated, with the ` ```console ` text block as the guaranteed fallback.

1. **Capability.** `initialize` reads `clientCapabilities._meta.terminal_output` and the bridge remembers it per connection.
2. **Neutral presentation vocabulary.** `dsh-tools` gains a terminal-shaped presentation a tool can return — provider-neutral (`cwd`, the output `data`, an `exitCode`/`signal`), NO ACP types. `dsh-tool-bash` returns it for `bash` (cwd from the resolved workdir; output + exit parsed from the run result).
3. **Bridge mapping.** When the client advertised the capability, the bridge maps that presentation to: on `tool_call`, `content:[…, {type:'terminal', terminalId}]` (any tool `content`, e.g. the description, rendered BEFORE the terminal block) + `_meta.terminal_info.{terminal_id,cwd}`; on `tool_call_update`, `_meta.terminal_output.{terminal_id,data}` (the captured output) + `_meta.terminal_exit.{terminal_id, exit_code|signal}` (the parsed exit), with the update's text `content` OMITTED (an ACP `tool_call_update.content` REPLACES the call's content collection, so re-sending the fenced block would clobber the terminal content block). `terminalId` is derived from the harness `callId` (stable, unique per call). When the capability is absent, the bridge sends the description content block on the call and the existing ` ```console ` text content on the update — unchanged.
4. **The exit pill is parsed from the rendered output; no new execution path, no live streaming.** Output is attached at completion (from the agent's own `tool/result`), not streamed token-by-token. The exit-status pill (`_meta.terminal_exit.{exit_code,signal}`) IS emitted: the pure `presentResult(args, result)` seam sees only content blocks, so `dsh-tool-bash` recovers the structured exit by parsing the status markers (`[exit code: N]` / `[killed by signal: …]`) that `renderResult` appended — the parse is the exact inverse of the marker emission, the two co-evolve in one file, and a round-trip test guards the pair. Disposal is unaffected: nothing new to tear down, since the bridge never creates a client-side terminal.

## Alternatives considered

- **The ACP client-side terminal sub-protocol (`terminal/create`)** — explicitly rejected: the editor would execute the process, bypassing `dsh-bash`'s env scrub, background-task ownership, and per-session cwd, and forking execution into two backends. Both reference agents reject it the same way (the key finding above); agent-side execution plus the `_meta` convention is the only shape that yields the terminal card while keeping the harness's execution policy.
- **Threading a structured exit through the event schema** — rejected in favor of the marker round-trip: the pure `presentResult(args, result)` seam sees only content blocks, and the parse is the exact inverse of the marker emission, co-evolving in one file under a round-trip test.

## Consequences

- **Zed-convention `_meta` keys.** The terminal card rides on Zed-specific keys (`terminal_info`/`terminal_output`/`terminal_exit`) inside ACP's spec-blessed `_meta` extensibility point, NOT on the ACP terminal sub-protocol. A client that doesn't recognize the keys still gets the text fallback (the capability gate ensures we only emit them when the client opted in via `_meta.terminal_output`), so a non-Zed client is never worse off. If ACP later standardizes agent-executed terminals, migrate to that and drop the convention keys.
- **Capability honesty.** Emit terminal metadata ONLY when the client advertised `_meta.terminal_output`; the text fallback is the contract for everyone else and must never regress. Covered by a no-capability test asserting the ` ```console ` path.
- **terminalId collisions.** Deriving it from the per-call `callId` keeps it unique within a session and stable across the call/result pair; never reuse one across calls.
- **Exit parsed from rendered text.** The exit pill recovers `exit_code`/`signal` by parsing `renderResult`'s status markers rather than threading a structured exit through the event schema (which the pure `presentResult` seam never sees). The parse is the exact inverse of the marker emission and lives in the same file; a round-trip test pins the pair so a marker-format change that breaks the parse fails the suite. If the markers ever need to diverge from what the pill wants, surface a structured exit on the result event instead.
- **Provider-neutral vocabulary creep.** The terminal presentation widens the `dsh-tools` surface; keep it neutral (no ACP types leak into `dsh-tools`) and only as rich as a second UI consumer would also want.

## Out of scope / non-goals

The text-block baseline stays the no-capability default. Two follow-ups are deliberately NOT built here and would each warrant their own Agent Note when someone takes them on: **live incremental streaming** (`_meta.terminal_output_delta` as chunks arrive, which needs an incremental-output seam on `dsh-bash`), and **command classification** (parsing a `cat`/`sed` as a `read` card with a file location, a `grep` as a `search`, etc., falling back to the terminal card — display-only, must never change what executes).
