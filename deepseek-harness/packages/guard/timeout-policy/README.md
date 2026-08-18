# dsh-tool-call-timeout-policy

English | [中文](README.zh.md)

Tool-call timeout enforcer: a single `tools/execute` around-dispatch listener that arms a per-call cooperative deadline on `exec.signal` for a tool declaring `timeoutMs` on its `ToolDefinition` and returns a structured `TOOL_TIMEOUT` result when that deadline wins. The budget is read from the tool's own declaration (`ToolDefinition.timeoutMs`, set by the owning tool plugin), so this plugin is **zero-config**. It is the reference `tools/execute` wrapper and the enforcement home for model-facing tool-call budgets ([timeout-library Agent Note](../../../.agents/notes/implemented/architecture/2026-07-06-timeout-deadline-library.md)).

## Plugin (namespace: `timeout-policy`)

A function/namespace plugin (`name` / `inject` / `apply`), not a service. It registers no tool and takes no config — it consumes `ctx.tools`'s `tools/execute` waterfall (which the `dsh-tools` registry always provides) and reads each dispatched tool's declared `timeoutMs` from the registry (`ctx.tools.get(exec.name)`).

```yaml
- id: timeout-policy
  name: '@deepseek-ai/dsh-tool-call-timeout-policy'
```

The per-tool budget is declared by the tool plugin (e.g. `dsh-tool-web`'s `fetchTimeoutMs`/`searchTimeoutMs` config, attached as `ToolDefinition.timeoutMs`); this plugin only enforces it, so a mistyped tool name is not possible.

### Behavior

For a tool that **declares a `timeoutMs`** the listener:

1. Reads the budget from the tool's own declaration in the registry (`ctx.tools.get(exec.name)?.timeoutMs`) and arms `deadline(exec.signal, timeoutMs, 'TOOL_TIMEOUT')` — one signal fusing the caller's abort with this plugin's timer (`@deepseek-ai/dsh-timeout`).
2. Swaps that derived signal onto `exec` for the downstream dispatch, then restores the caller's own signal afterward (cordis `next()` ignores passed arguments, so the wrapper mutates the shared `exec` in place; restoring keeps `tools/post-execute` seeing the caller's signal).
3. After dispatch, if `timeoutOf(d.signal, 'TOOL_TIMEOUT')` matches — this plugin's own timer fired — replaces the result with a structured `TOOL_TIMEOUT` tool result: `{ isError: true, error: { message, info: { name: 'ToolTimeoutError', code: 'TOOL_TIMEOUT' } }, content: 'Error: tool call timed out after <ms>ms' }`.

A tool that **declares no budget** delegates untouched (no deadline).

The base `next()` of `tools/execute` is the registry's dispatch-with-normalization thunk, so when the timeout signal reaches a provider that throws its own upstream-abort error, dispatch first turns it into a normal error result, and this wrapper then replaces that with `TOOL_TIMEOUT`. That ordering is why the replacement is keyed off the signal (`timeoutOf`), not off the dispatched result's shape.

### Cooperative, not a hard kill

The derived signal only **notifies**; termination stays with the tool and the capability it forwards `exec.signal` to (the `dsh-timeout` library owns no kill). **Declaring `timeoutMs` therefore means "cooperative with `exec.signal`"**: a tool that ignores the signal will not stop on timeout. Only signal-forwarding tools should declare it — the shipped `web_fetch`/`web_search` (which forward through `ctx.web` to providers) are the reference. `TOOL_TIMEOUT` needs no session event for reconstructability: it is the final model-facing `tool/result`, already logged by the loop.

### Composing with other `tools/execute` wrappers

Multiple `tools/execute` listeners compose by cordis registration order. Combined with a future retry/sandbox/metrics wrapper, registration order chooses the semantics — "timeout covers the whole retry operation" (timeout registered outer) versus "timeout covers each attempt" (timeout registered inner).

## Model Experience

### Conditional tool result

#### What the model sees

This plugin adds no prompt or schema. If a declared deadline wins, it replaces the provider's outcome with `Error: tool call timed out after <ms>ms` plus structured `TOOL_TIMEOUT`; otherwise the original result passes through unchanged.

#### Token effect

Zero tokens on non-timeout calls. A timeout adds one small retained error result and can prevent a larger late provider result from entering context.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **Cooperative, never a hard kill** — the deadline only notifies via `exec.signal`; a tool that ignores the signal does not stop on timeout (see § Cooperative, not a hard kill).
- **No blanket budget** — only tools that declare `timeoutMs` on their `ToolDefinition` get a deadline; there is no registry-wide default for undeclared tools (the shipped `bash`/`read`/`write`/`edit` deliberately declare none).
