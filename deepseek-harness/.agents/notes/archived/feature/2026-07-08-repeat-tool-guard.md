# Agent Note: Repeat-tool-call guard plugin

Status: implemented
Archived: 2026-07-27

English | [中文](2026-07-08-repeat-tool-guard.zh.md)

## Problem

A model stuck in a loop re-issues the same tool call with byte-identical arguments — re-running a failing grep, re-reading an unchanged file, polling a command that already gave its answer — and each round trip burns tokens, wall-clock, and (for paid APIs) money without adding information. The harness has nothing that notices: the loop has no step budget, no plugin tracks call repetition, and the model only escapes when it happens to vary its own behavior. The failure mode is real and cheap to detect — [pi-repeat-tool-guard](https://github.com/Kingwl/pi-repeat-tool-guard) ships exactly this as a pi coding-agent extension: count consecutive identical calls and, past a threshold, append a `<system-reminder>` telling the model to stop repeating itself and change course.

The harness already has every seam the pi extension uses, and better ones: [the interception-seams Agent Note](2026-06-30-interception-seams.md) gives `tools/post-execute` a sanctioned way to attach model-facing context to a finished call, the loop buffers and injects that context with call/result adjacency preserved, and injected context is a logged `context/message` — so a native guard satisfies the model-visible ⟺ logged rule with no new session event. What was missing was only the plugin itself.

## Decision

The guard is a loop-hygiene plugin, not a model-facing tool. It counts consecutive calls to the same tool with identical canonical arguments and injects advisory reminders at configured thresholds. It never delays, blocks, or rewrites a call; the model decides whether to retry differently or finish.

The plugin is `@deepseek-ai/dsh-repeat-tool-guard` at `packages/guard/repeat-tool-guard/`, opening the `guard/` group for loop-hygiene plugins (single-package groups have precedent: [the todo-write Agent Note](2026-06-29-todo-write-tool.md) shipped `todo/tool-todo`). It registers two listeners and holds state in a `WeakMap` keyed by the live `Agent` object — the tool registry is a context-level singleton whose waterfalls interleave every agent's calls (subagents run on the same context), so per-agent keying is correctness, not polish; weak object keys also make a disposal-only cleanup listener unnecessary.

- **`tools/post-execute` (waterfall)** — the one detection point. The listener receives `(exec, result)` together, so counting and reminder delivery need no cross-event pending map (the pi extension needs one only because its `tool_call`/`tool_result` hooks are separate events). It always delegates via `next()` and, when a threshold is hit, prepends a reminder to the downstream decision's `additionalContexts` — the observe-and-enrich posture [the hooks bridges](2026-06-30-hook-bridges.md) already use, honoring the waterfall contract. Counting happens here rather than in `tools/pre-execute` because post-execute also runs for denied calls (`ToolRegistry.execute` routes a deny through the same pipeline), and a model hammering a denied call is exactly the loop worth breaking.
- **`agent/prompt-submit` (waterfall)** — pure reset hook: delegate via `next()`, clear the submitting agent's chain. A user interjection changes the context; repetition across it is not a loop.

### Detection semantics

The chain key is `(tool name, canonical arguments)`; a call identical to the previous tracked call increments the agent's consecutive counter, a different tracked call resets it to 1. Canonicalization is a deep key-sort plus `JSON.stringify`: `ToolExecution.arguments` is by construction the loop's `JSON.parse` output (or the raw string fallback for malformed argument JSON, which is itself a comparable value), so the pi original's bigint/circular/`undefined` handling has no inputs here and is deliberately dropped.

Two deliberate rules, both documented in [the package README](../../../../packages/guard/repeat-tool-guard/README.md) because they are behavior a reader would otherwise guess at:

- **Untracked calls are transparent to the chain.** A call excluded by `include`/`exclude` neither increments nor resets the counter, so `grep X → todo_write → grep X` still counts as two consecutive `grep X` when `todo_write` is excluded. This is what makes exclusion useful — bookkeeping tools interleaved into a loop must not launder it — and it is the pi extension's (undocumented) semantics, kept on purpose and written down.
- **Calls without an agent are ignored.** A direct `ctx.tools.execute()` caller (tests, non-loop consumers) has no model to remind and no live agent object to key on.

### Reminder delivery

Reminders ride `additionalContexts` as their own entries (source `{kind: 'plugin', plugin: 'repeat-tool-guard'}` — the label is load-bearing per `HookContext`), never a `content` replacement: the `tool/result` event stays the tool's own output for audit, and the loop appends buffered contexts as `context/message`s after the step's results, which the session renders as tagged synthetic-user envelopes and derived history replays. Thresholds escalate: the first configured threshold gets a short "you are repeating yourself, analyze the previous result" nudge; each later threshold gets the detailed form naming the tool, the repeat count, and the canonical arguments (head-truncated at `argumentsPreviewChars`, default 500 — a looping `write`-sized payload must not ride into the next request unbounded; the chain key always compares the full canonical string), and stating that the calls made no progress. The pi original hardcodes the gentle text to the literal count 3; the guard keys it to `thresholds[0]`, fixing that bug in the port. A downstream hook bridge contribution remains a separate array entry, so both plugins retain their source, envelope, and metadata.

### Config

```yaml
- id: repeat-tool-guard
  name: '@deepseek-ai/dsh-repeat-tool-guard'
  config:
    thresholds: [3, 5, 8]        # default; consecutive counts that trigger a reminder
    include: []                  # tool-name patterns to track; empty ⇒ all tools
    exclude: [todo_write]        # tool-name patterns transparent to the chain
    argumentsPreviewChars: 500   # default; cap on arguments quoted in the detailed reminder
```

`thresholds` is validated at load and throws on an empty list, a non-integer, a value below 2, or a duplicate — misconfiguration fails loud, replacing the pi original's silent fall-back to defaults. `include`/`exclude` entries support `*` wildcards. Patterns are predicates over whatever tools exist at call time, not references to a registry entry, so an entry matching no currently registered tool is NOT an error — unlike `toolOrder`'s referent check, `exclude: [mcp_*]` must stay valid in a deployment that loads no MCP tools.

## Testing

- **Unit:** A real loop with a scripted adapter covers counting and reset rules, untracked transparency, disposal cleanup, per-agent isolation, canonical argument key order, escalation, denied calls, no-agent execution, wildcard escaping, invalid config, and downstream block or replacement decisions at per-file 100% coverage.
- **Snapshot:** The keyless `repeat-tool-guard` scenario makes five identical `todo_write` calls and pins the gentle third-call and detailed fifth-call reminders in both ACP output and the session log. The plugin is loaded in the live example but remains inert in other scenarios.
- **E2e:** None; the plugin is deterministic and provider-independent, and its seam contracts are covered by their owners.

## Alternatives considered

- **Append the reminder into the tool result** (`accept` with replaced `content` — the pi extension's mechanism, which patches result content because that is the only channel its API offers) — rejected: it makes the logged `tool/result` lie about what the tool returned, and `additionalContexts` is the separate sanctioned channel for post-execute commentary, with loop-level buffering that preserves call/result adjacency.
- **Count in `tools/pre-execute` with a pending-reminder map** (the pi two-phase shape) — rejected: post-execute alone sees `(exec, result)` together and also fires for denied calls, so one listener with no cross-event state covers strictly more attempts with less machinery.
- **Escalate to `block` at the highest threshold** — rejected for the initial scope: a blocked call punishes legitimate identical repeats (polling a long-running terminal, re-checking a file the agent expects to change), and an advisory reminder keeps the model in control. Revisit with evidence; the decision shape (`PostToolDecision`) already supports it.
- **A per-deployment external hook via the CC/Codex bridges** (a `PostToolUse` script) — rejected as the answer: it works for one deployment, but a shipped, unit-tested, `cordis.yml`-configurable plugin is the harness-native form, without per-call subprocess cost.
- **A loop-level step or repetition budget in `agent-loop`** — rejected: "plugins, not loop changes"; a hard step budget is a blunter, orthogonal control that would need its own proposal.
- **Fuzzy/near-identical detection** (normalized paths, similar-but-not-equal arguments) — rejected: exact match after canonicalization is cheap, deterministic, and explainable to the model; similarity thresholds invite false positives and need evidence before they earn complexity.
- **Placing the package in `core/`** — rejected: core is the product spine; a behavioral guard is an optional leaf plugin, and the `todo/` precedent is a small dedicated group per plugin family.

## Consequences

- The reminder is advisory by design: idempotent polling patterns that repeat identical calls on purpose still receive nudges past the thresholds, and the pressure valves are config (`thresholds`, `exclude`) plus reminder text that explicitly allows finishing when enough evidence has been gathered. Each trigger costs reminder tokens on the next request; thresholds bound the frequency.
- Chain state is in-memory only: a session resumed from persistence starts with a fresh chain, so a loop spanning a resume draws its reminders later than a live one — accepted, the guard is a heuristic nudge, not a logged invariant, and persisting counter state would buy little for real complexity.
- When multiple post-execute producers attach context on one call, each contribution stays a separate `HookContext`; ordering follows waterfall nesting and each entry retains its own provenance.
- Implementing the snapshot tier surfaced a hidden assumption in the suite kit: the fixture guard equated "authored model scenario" with "override-driven". The `Scenario` table now carries an explicit `overridden` flag, and the sidecar's presence is checked BOTH ways against it (an unregistered stray sidecar would silently replace the derived script) — the suite kit is stricter than it was before this plugin existed.

## Deferred

- Compaction does not reset chains: a compacted history changes what the model sees, but the repetition risk usually survives compaction.
- Escalating to `block` at a high threshold is not implemented; `PostToolDecision` already supports it if evidence arrives.
- Subagent chains stay isolated per agent; no sharing mechanism exists until a concrete case appears.
