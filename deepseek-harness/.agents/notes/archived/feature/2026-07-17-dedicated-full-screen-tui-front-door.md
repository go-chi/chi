# Agent Note: Dedicated full-screen TUI front door

Status: implemented
Archived: 2026-08-04

English | [中文](2026-07-17-dedicated-full-screen-tui-front-door.zh.md)

## Problem

The reusable TUI package remains implemented, but [`dsh` no longer ships it as an application entrypoint](../simplification/2026-08-03-explicit-config-dsh-entrypoint.md). This note continues to own the package boundary and terminal behavior; the later note owns product composition.

At the time this front door was introduced, the line-oriented agent handled pipes and ordinary terminals, but a full-screen coding interface had to own raw input, differential screen drawing, cursor state, overlays, and terminal restoration. Combining those contracts in one UI plugin would have coupled a stream-oriented path to a TTY-only lifecycle. The later [redundant-agent removal](../simplification/2026-07-20-remove-stdio-and-echo-agents.md) removes that line agent; this Note continues to own the TUI design.

The interactive channel must remain a Cordis plugin over the same agent, session, tool, and user-interaction services as every other front door. It needs to resume durable history, follow compaction replacements, display tool-owned presentation, and restore the terminal on startup failure and disposal. A standalone chat application or a second agent composition would duplicate behavior outside the plugin graph.

## Decision

DeepSeek Harness ships [`@deepseek-ai/dsh-tui`](../../../../packages/ui/tui/README.md) as a dedicated Cordis plugin. It owns terminal input and presentation only; agent lifecycle, session persistence, tool execution, and the model-facing question tool remain separate composition entries. The plugin requires both stdin and stdout to be TTYs and fails instead of silently changing to line-oriented behavior.

The package is a terminal front door, not a complete application. A host mounts `@deepseek-ai/dsh-tui` before its configured agent and composes the backends, tools, and policies around it. The product CLI currently ships no terminal composition; non-interactive tasks use headless mode, Web owns the installed human surface, and ACP remains a separate automation protocol.

The host supplies the exact generated or resumed `SessionId` used by its pre-created agent. The TUI waits for the matching root agent and enters full-screen mode only after that agent exists. A matching `agent-loop/config-start-failed` event is therefore reported before screen takeover.

### Session projection and interaction

The TUI rebuilds the transcript from the append-origin session events, so resumed history keeps every message the reader already saw; a compacted range stays readable behind one marker instead of matching the model-visible conversation ([append-origin transcript](../bug-fix/2026-07-29-human-transcript-append-origin.md)). It renders Markdown text and reasoning, including fenced code with hidden Markdown markers, a dim optional language label, and a code-colored body, token totals, the latest `todo/write` plan, and tool cards produced through each tool definition's `presentCall` and `presentResult` methods. Long card bodies retain a configurable head/tail preview with the hidden-line count; one terminal control expands or collapses every card. Pending chunks and tool calls update the same components that completed events settle.

Editor input calls `agent.send()` while idle and `agent.steer()` while a turn is running. Cancellation, reasoning visibility, tool-card expansion, redraw, transcript clearing, and exit are terminal-only controls. `/exit` and `/quit` share the same exit path: they cancel an active turn, wait for idle, and then restore and close the terminal. The idle footer derives context occupancy from `tokenMeter` and shows the selected model and explicit reasoning effort; during a run, elapsed activity and the Escape interrupt hint replace that summary. `/status` remains available in either state and appends a detailed terminal-only snapshot: session identity and timestamps, selected model, reasoning effort/default state and reasoning visibility, lifecycle counts folded from the event log, the same deduplicated usage buckets and KV-cache rate as the footer, and context use from `tokenMeter` plus the selected model's advertised capacity. The plugin registers the shared `userInteraction` provider and presents queued questions in a wide bottom-left keyboard panel with batch progress, numbered options, and aligned descriptions; the panel's controls hint lists only actions meaningful for the current option count, omitting navigation when exactly one option is shown; agent behavior and answer logging remain owned by their existing services.

The `/model` command presents the advisory `ctx.llm` catalog as a keyboard selector and changes only this TUI session's target; argument forms remain available for direct selection. The selector carries a filter box above the list: typing narrows the rows to a case-insensitive substring over each row's `provider/model` label, model name, and description, keeping the selection on the previously highlighted row when it survives the filter; Escape clears a non-empty filter before a second Escape cancels the selector. Each model row owns the adapter-advertised reasoning-effort order and default: Shift+Tab cycles that row's efforts, includes provider-default behavior when the adapter advertises no default, and leaves models without selectable metadata unchanged. Agent-scoped prompt-assembly and request waterfalls snapshot one provider/model/reasoning-effort target per step, so `{{provider}}` / `{{model}}` interpolation and request routing cannot split when a command arrives during assembly. The latest logged request header restores a used target; a selection that never reaches a request remains process-local.

### Terminal ownership

Before model output, session data, tool presentation, questions, configuration, or diagnostics reach pi-tui or the terminal title, `displayText()` renders C0 and C1 controls other than line feeds as visible hexadecimal escapes. Only the TUI and pi-tui create ANSI control sequences.

The built-in palette uses standard 16-color ANSI foregrounds and SGR attributes, keeps body text and backgrounds at terminal defaults, and uses reverse video for selection. Host terminals therefore remap the interface for light and dark themes without a TUI-specific theme setting; `color: false` removes styling.

## Verification

The implemented [TUI terminal-state snapshot Agent Note](../testing/2026-07-18-tui-terminal-state-snapshots.md) owns the package verification contract: direct behavior tests and semantic terminal snapshots. A deployment shipping this front door owns its assembled transcript and process/PTY acceptance. The package README owns configuration, commands, model-visible effects, and current limitations.

## Alternatives considered

- **Keep readline and full-screen modes inside `@deepseek-ai/dsh-stdio`** — rejected because line-oriented output and differential TTY rendering have different dependencies, input rules, logging ownership, and teardown obligations. Separate packages keep the pipe-safe contract small and explicit.
- **Let the TUI plugin silently downgrade when either stream is not a TTY** — rejected because a fallback hides deployment mistakes and changes interaction semantics. A host may select a different front door; an explicitly mounted TUI fails loud.
- **Keep TUI wiring and tests under the readline `repl-agent` leaf** — rejected at the time because one leaf would represent two distinct front doors. The later product-entrypoint removal deleted that application wiring while retaining the package boundary.
- **Mutate `agent.options` when `/model` runs** — rejected because creation options do not provide an atomic boundary between asynchronous prompt assembly and request routing. Agent-scoped waterfalls preserve immutable creation input and snapshot the selected pair for each step.

## Consequences

- Deployments that mount the TUI gain a stateful Markdown, card, plan, and question interface with no second terminal protocol to keep aligned.
- The TUI carries a pi-tui dependency and a strict TTY requirement; non-TTY deployments use the Headless app or a structured protocol.
- Session projection makes resume consistent with the durable conversation, but one configured session owns the transcript and editor.
- Tool packages extend terminal cards through their existing presentation methods without adding tool-specific branches to the TUI.
- Model and reasoning-effort selection use adapter-advertised metadata without turning catalog membership into request validation; unused selections are not durable state.
