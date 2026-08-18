# Agent Note: Ship the TUI without `todo_write`; keep it a one-line opt-in

Status: implemented
Archived: 2026-07-26

English | [中文](2026-07-21-tui-todo-write-opt-in.zh.md)

## Problem

The shipped tui-agent `cordis.yml` loaded `@deepseek-ai/dsh-tool-todo`, exposing `todo_write` by default. The tool is a task-tracking convenience, not a core coding affordance like `bash` or the `read`/`write`/`edit` fs tools; most TUI sessions never call it, yet shipping it enlarges the wire tool list and system prompt for every turn. Meanwhile the TUI's plan rendering is event-driven: `packages/ui/tui/src/index.ts` listens for the `todo/write` session event and `TodoComponent.render` returns nothing when the list is empty, so the front door already tolerates the tool being absent or present with no runtime coupling to the plugin.

## Decision

The tui-agent `cordis.yml` no longer loads `tool-todo`; `todo_write` is opt-in. The `code-mode.cordis.yml` overlay inherits the base composition, so its generated SDK drops `todo_write` too. Enabling it is one entry — add `@deepseek-ai/dsh-tool-todo` to `cordis.yml` (or a `~/.dsh` personal overlay) — after which the model logs the whole-list `todo/write` snapshot and the TUI renders the plan, unchanged. The `TodoItem` type and the `todo/write` event stay in `@deepseek-ai/dsh-session` and the TUI's plan rendering stays wired, so both the default (disabled) and opt-in (enabled) paths are first-class. The sibling acp-agent, headless-agent, and jsonrpc-agent examples still ship the tool.

## Alternatives considered

**Keep `todo_write` in the shipped TUI default** — rejected: it is an opt-in convenience, not a core tool, and shipping it spends every turn's tool-list and prompt budget on a feature most sessions ignore. The examples that still ship it retain the plugin's real-composition coverage.

**Drop the TUI's plan rendering and todo tests along with the default entry** — rejected: the requirement is to support both the enabled and disabled cases, and the event-driven `TodoComponent` already renders plans with zero plugin coupling, so deleting it would discard a working capability for no gain. The enabled path keeps dedicated coverage instead.

## Testing

`examples/tui-agent/tests/tui.snapshot.ts` mounts `ToolTodo` only when a scenario sets `enableTodo`: only the `todo-plan` scenario does (the enabled-path proof, whose `session.jsonl`/`terminal.expected.txt` pin the rendered plan), while every other scenario runs the default todo-free composition. `tests/harness.ts` makes `ToolTodo` a `todo` opt-in that only `tests/todo-write.e2e.ts` sets, so the with-key todo e2e still drives the real tool while the other suites match the shipped stack. The keyless `tests/tui-keyless-smoke.e2e.ts` boots the real `cordis.yml` and asserts nothing about todo, so the default boot is unaffected.

## Consequences

The default TUI wire tool list and system prompt shrink by one tool; a session that wants task tracking adds one plugin entry. `examples/tui-agent/composition.md` (regenerated) and its leaf-entry table no longer list `tool-todo`, and the curated summary in `scripts/gen-doc-graphs.ts` drops it. The `@deepseek-ai/dsh-tool-todo` package is unchanged and still shipped by the acp/headless/jsonrpc examples, so its coverage requirement is met there. Restoring the default would re-add the one `cordis.yml` entry and flip the snapshot/harness opt-in flags back on.
