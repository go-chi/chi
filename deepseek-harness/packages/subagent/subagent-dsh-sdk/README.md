# @deepseek-ai/dsh-subagent-dsh-sdk

English | [中文](README.zh.md)

The SDK provider runs each subagent as a complete DeepSeek Harness runtime in a fresh subprocess, driven over stdio JSON-RPC through the [TypeScript SDK client](../../sdk/client/README.md). It is the second out-of-process backend beside [`subagent-acp`](../subagent-acp/README.md), differing in the wire and the child contract: the ACP backend drives any Agent Client Protocol agent; this backend drives specifically a harness SDK runtime (`dsh-jsonrpc-agent` bin or packaged executable), so the child is a full peer harness — own `cordis.yml`-decided composition, session persistence, model route, and tools.

## Start and ownership

`start(request)` resolves the child's working directory, spawns the runtime through `DeepSeekHarness`, and completes the `initialize` handshake (with the configured `provider`/`model` route and optional `maxTokens` output cap) before it fulfills. Fulfillment therefore means the child runtime is ready and ownership has transferred to the caller. A spawn, handshake, or pre-publication cancellation failure rejects only after the subprocess has been reaped; a working-directory resolution failure rejects before anything is spawned.

The working directory resolves exactly like the ACP backend, through the seam's shared out-of-process helpers ([`dsh-subagent`](../subagent/README.md)): the configured `cwd` override when set (validated once at load), else the delegating parent session's cwd — never the server process's own cwd. The resolved path becomes the child process cwd and the workspace cwd of its SDK session.

The returned run id is minted in the parent namespace; the child runtime's session id exists only inside the child process. After publication the provider owns one SDK activity and reads the child's answer from its session events: the last complete non-empty `assistant/message` (an empty-content message that records usage is skipped), or the accumulated `text-delta` stream when no such message exists. Partial output remains available after cancellation or an error.

`dispose()` is idempotent: it settles the result locally as `aborted` (there is no wire-level prompt cancel), then closes the runtime — a bounded protocol `shutdown` request followed by the shared stdin-EOF → SIGTERM → SIGKILL ladder to actual exit.

## Stop-reason mapping

The SDK client returns an owned child activity rather than a prompt result. The provider reads the last durable `turn/end` inside that activity and maps it into the seam vocabulary: `completed` → `completed`, `max-tokens` → `max-tokens`, `aborted` → `aborted`; everything else — `error`, `interrupted`, `disposed`, a future variant, or an activity with no turn — maps to `error`, so an unclean stop is never reported as success. Transport-level failures after publication flatten to `stopReason: 'error'` through the `onError` diagnostic sink (wired to `ctx.logger.warn`); the seam contract forbids `result` rejecting.

## Capabilities and context

The provider advertises no start-time capabilities (`outputSchema`/`depthLimit`/`toolFilter`/`persona` all false) and `inheritsParentContext: false`: the child is a fresh runtime in another process, and the only parent-derived input is the workspace cwd. `dsh-tool-subagent` deployments over this provider set `maxDepth: 'provider-managed'` — the child harness owns its own recursion budget.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `providerName` | `dsh-sdk` | Registry name on `ctx.subagents`. |
| `command` | required | Executable spawned per run (the child runtime bin or packaged exe). |
| `args` | `[]` | Command arguments (typically the child's `cordis.yml` path). |
| `cwd` | parent session cwd | Working-directory override; same validation as [`subagent-acp`](../subagent-acp/README.md). |
| `provider` | `deepseek-official` | Provider route sent in the child's `initialize`. |
| `model` | `deepseek-v4-flash` | Model sent in the child's `initialize`. |
| `maxTokens` | adapter/provider route default | Per-request output-token cap sent in the child's `initialize`; it applies to the child root agent and its in-process descendants. |
| `env` | `{}` | Explicit child environment layered over a credential-scrubbed parent environment (e.g. the child's own `DEEPSEEK_API_KEY`, or `DSH_CORDIS_CONFIG`). |
| `shutdownTimeoutMs` | `1000` | Bound on the protocol `shutdown` exchange during dispose. |
| `disposeEofGraceMs` | `6000` | Grace after stdin EOF before platform termination. |
| `disposeGraceMs` | `3000` | Exit-confirmation grace after termination; POSIX also waits this long after SIGTERM before SIGKILL. |

```yaml
- id: subagent-dsh-sdk
  name: '@deepseek-ai/dsh-subagent-dsh-sdk'
  config:
    providerName: dsh-sdk
    command: node
    args: ['./packages/examples/jsonrpc-demo/lib/bin.js', './examples/jsonrpc-agent/cordis.yml']
    maxTokens: 49152
    env:
      DEEPSEEK_API_KEY: !!js process.env.DEEPSEEK_API_KEY
- id: tool-subagent
  name: '@deepseek-ai/dsh-tool-subagent'
  config: { provider: dsh-sdk, toolName: subagent, maxDepth: 'provider-managed' }
```

## Process boundary

The child environment is the [`dsh-subprocess`](../../subprocess/README.md) seam's `scrubbedParentEnv()` base — ambient credential-shaped and `DSH_*` names dropped — with explicit `config.env` values merged after the scrub. The child is spawned by the SDK client rather than through `ctx.subprocess` (the subprocess README's documented exception for SDK-managed transports), which is why this backend applies the scrub itself. The JSON-RPC wire is the real serialization boundary.

The package has no default export. Cordis loader unwrapping would otherwise hide the named `inject` metadata; see [postmortem 0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.md).

## Model Experience

### Child-agent request

#### What the model sees

The child runtime's model receives the standalone task as its user message plus that runtime's own configured system prompt, tools, and fresh session. It receives no parent conversation. This provider advertises no optional start-time capabilities, so the local service rejects requests for persona, tool filtering, depth enforcement, or structured output instead of silently omitting them.

#### Token effect

The child pays for an independent full context and its own multi-step history. These tokens never enter the parent's context.

#### KV Cache effect

Independent of the parent request cache. Each SDK child can reuse only prefixes identical under its own provider, model, composition, and history; child steps otherwise grow append-only.

### Parent tool result, indirectly

#### What the model sees

Through `dsh-tool-subagent`, the parent receives only the child's final assistant text (or accumulated partial text) or that consumer's exact stop-reason error, not intermediate messages or tool traffic.

#### Token effect

Parent input grows only by the final result or error, which is data-dependent and retained until compaction. This provider adds no parent schema itself.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **A fresh runtime process per run** — no pooling; a harness runtime boots a full plugin tree, so per-run spawn cost is higher than the ACP backend's typical child.
- **No optional start-time capabilities** — the parent cannot enforce `outputSchema`, depth, tool filters, or persona inside the child process; configure the child's own `cordis.yml` instead.
- **The child's transcript stays in the child's own session root** — the parent log records only the delegation tool call/result (the seam's child-isolation rule); the streamed `session.event` channel is consumed for output extraction, not bridged into the parent log.
- **Local child processes only** — the resolved cwd is a local path; a remote runtime would need its own backend.
