# @deepseek-ai/dsh-tool-workflow

English | [中文](README.zh.md)

The model-facing **`workflow` tool**: run a JavaScript orchestration script that fans out subagents, and return the script's final value. This package owns the model-facing schema and run lifecycle over [`ctx.workflowEngine`](../workflow/README.md); script parsing, execution, caps, and cancellation live behind the seam, while the consumer retains ownership of the parent-facing schema and result envelope.

## What the model sees

Three parameters: `meta` (required identity data: `name`, `description`, and optional progress annotations), `script` (required plain JavaScript body — no `export const meta` statement; the tool description carries the complete authoring contract), and `args` (optional JSON object exposed to the script as the `args` global; wrap a bare list in a field so the wire schema stays honest). The plugin also contributes a `tool:<toolName>` system-prompt section carrying the usage policy — use the tool only on an explicit user ask for a workflow / large orchestration; prefer plain subagent calls for one or two delegations — per the convention that tool guidance ships with the tool plugin, never in the deployment persona.

## Lifecycle

Collection is synchronous (like [`dsh-tool-subagent`](../../subagent/tool-subagent/README.md)): `execute` starts a run and awaits `run.result` inside a `try/finally` that always disposes the run, so the script and its children reach quiescence on every path. `exec.signal` is bridged to `run.cancel()` (including the already-aborted-before-start case). A non-`completed` stop reason maps to an `isError` result reporting the reason—never partial output as success; a parse/meta failure thrown synchronously by `start()` becomes an `isError` the model can correct from. Completion returns canonical `{ runId, agentsStarted, result }`; the Native renderer preserves the meta name, agent count, and JSON value, truncating only that projection at `maxResultChars`.

For a root transport execution (`exec.parent` absent), the tool also projects the run into the calling Agent's Session: run-start after `start()` returns, matching member starts and endings filtered by `run.id`, then run-end only after `run.result` is available and `dispose()` has reached quiescence. Nested transport calls execute normally but write no workflow record. The first failed Session append disables later recording for that run, emits one warning, and leaves either no record or a legal continuous prefix without changing the tool result or cleanup.

The browser-safe `@deepseek-ai/dsh-tool-workflow/types` subpath owns these four log-only event payloads and their `SessionEventMap` declaration. The package invariant rejects duplicate starts, unpaired members, terminal events with open members, and updates after run-end on both cold load and live append while accepting missing terminal suffixes.

## Render intent

Decided up front (per the [render-intent Agent Note](../../../.agents/notes/implemented/architecture/2026-07-02-tool-render-intent-union.md)): a `generic` card titled `workflow: <meta.name>`, read directly from `args.meta.name` (presentation is a pure function of args and does not ask the engine to parse); the script text rides as `rawInput`. The result keeps the generic card.

## Config

| Key | Default | Meaning |
|---|---|---|
| `toolName` | `workflow` | The model-facing tool name to register. |
| `maxResultChars` | `50000` | Rendered-result ceiling; longer JSON is truncated with a notice. |

## Model Experience

### System prompt

#### What the model sees

Every parent request in this plugin's registration scope receives the workflow guidance below. A scoped tool restriction can hide the schema without removing this independently registered guidance.

##### Workflow guidance

```markdown
Use the <toolName> tool ONLY when the user explicitly asks for a workflow or for large multi-agent orchestration: you write a JavaScript script (the tool description documents the exact format) that fans work out across many subagents with phases and structured results. For one or two delegations, prefer plain subagent calls.
```

#### Token effect

Small fixed guidance cost per request while the plugin is active.

#### KV Cache effect

Prefix-stable while the plugin scope and guidance text are unchanged. Activation or disposal may invalidate reuse from this prompt section.

### Tool schema

#### What the model sees

When visible, the generated default [`workflow` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-workflow) carries the complete JavaScript hook and metadata contract; `toolName` can rename the definition, and the model submits script, metadata, and optional args.

#### Token effect

Substantial fixed schema cost on each request where the tool is visible.

#### KV Cache effect

Prefix-stable while `toolName`, definition, and visibility are unchanged. Renaming, plugin lifecycle, or scoped restrictions may invalidate reuse from this schema.

### Tool-call history and result

#### What the model sees

The full model-written script, metadata, and args remain in the assistant tool call. Success is exactly `workflow "<name>" completed (<count> agent<optional-s>).`, newline, `Return value:`, newline, and pretty-printed data-dependent JSON; a cap adds `… [truncated: <omitted> more characters]` on a new line. Failures are exactly `Error: workflow run was cancelled`, optionally suffixed ` (<error>)`, `Error: workflow run failed: <error-or-unknown error>`, or defensively `Error: workflow run ended abnormally (<reason>)`; a call without an owning agent becomes `Error: workflow tool requires a calling agent (exec.agent was undefined)`. Intermediate child messages are omitted.

#### Token effect

Call tokens can be large and remain until compaction. Result rendering is capped by `maxResultChars`; child-model tokens are separate from the parent's retained context.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **The parent turn blocks until the whole workflow settles** — there is no background start/poll API, and cancellation discards partial output as an error.
- **`args` must be an object and Native result text is bounded** — callers wrap top-level arrays/scalars in a field; the canonical workflow result remains complete, while JSON beyond `maxResultChars` is truncated in the model-facing projection rather than stored behind a retrieval handle.
- **Workflow policy is fixed per tool registration** — provider selection, caps, and tool name are deployment config, not model-call arguments.
- **Durable records are top-level and observational** — nested Code Mode dispatches are not recorded, and a recording failure intentionally degrades to an incomplete prefix rather than changing execution.
