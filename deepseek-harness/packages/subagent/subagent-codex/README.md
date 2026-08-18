# @deepseek-ai/dsh-subagent-codex

English | [中文](README.zh.md)

This package registers the fixed `codex` subagent provider. Each accepted run starts the official `codex app-server --stdio` command in the delegating Session's workspace, creates one ephemeral Codex thread, submits one self-contained text task, and returns only the final answer through the shared [`dsh-subagent`](../subagent/README.md) result contract.

## Start and ownership

`start(request)` accepts only a non-empty sequence of text blocks and derives the child cwd from the parent Session. It then spawns the fixed command through [`dsh-subprocess`](../../subprocess/subprocess/README.md), performs `initialize` → `initialized` → `thread/start { cwd, ephemeral: true }`, and publishes the run only after Codex returns a valid ephemeral thread. A failure or cancellation before publication closes the wire, terminates the managed process tree, waits for it to exit, and rejects `start()`.

The published `run.result` starts exactly one turn. It accepts only notifications for that run's thread and turn, then waits for the authoritative `turn/completed` terminal notification. The latest `agentMessage` with `phase: "final_answer"` wins; when Codex emits no explicit final phase, the latest message with `phase: null` is the compatibility fallback. Commentary never replaces either answer, and a successful turn with no nonblank answer settles as an error.

For command and file approvals, the unattended provider selects a non-approval decision offered by the request, preferring `cancel`; the stable 0.147.0 request shape without an offered-decision list falls back to `decline`. It answers permission requests with an empty turn-scoped permission set, answers user-input requests with no answers, and declines MCP elicitation. A request with no legal unattended response, or any unknown server request, fails the run.

Local cancellation wins the result race and maps to `aborted`. A failed turn whose `codexErrorInfo` is `contextWindowExceeded` maps to `max-tokens`; every other remote interrupted or failed turn maps to `error`, and the provider produces no `refusal`. `dispose()` is idempotent: it requests a best-effort `turn/interrupt` with both current ids when they are known, closes the JSON-RPC wire, ends stdin, invokes the shared process-tree termination escalation, and waits for whole-tree exit. Result failure and independent teardown failure remain separate.

## Capabilities and context

The provider advertises no optional start-time capabilities and reports `inheritsParentContext: false`. Codex receives the standalone text task and the parent Session cwd, but not the parent conversation, persona, tool filter, depth policy, or structured-output contract. The ephemeral Codex thread id and turn id stay private to this run and are never persisted in the parent Session.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `env` | `{}` | Explicit child environment layered over the subprocess seam's credential-scrubbed parent environment. |
| `disposeGraceMs` | `3000` | Positive finite grace in milliseconds, no greater than [`MAX_TIMER_DELAY_MS`](../../util/timeout/README.md), between the shared process-tree owner's termination tiers; disposal then waits for whole-tree exit. |

Production resolves `codex` from `PATH` and uses the host's native Codex configuration and authentication. The plugin does not install Codex, select a model, create `CODEX_HOME`, log in, or probe a version. Credential-shaped ambient variables are removed by the subprocess seam, so an API key intended for the child must be supplied explicitly in `env`; ordinary ambient values such as `PATH` and `HOME` remain available unless overridden.

Production `dsh` does not install or mount this optional provider. A Profile that opts in must install `@deepseek-ai/dsh-subagent-codex` and mount it once on the host plane; loading the provider starts no Codex process until a tool call. Full Agent Presets carry a matching product tool row with `disabled: true`; copy a preset and remove that field to expose `subagent_codex` only to agents composed from the copy. Its `one-shot` policy keeps omitted or `false` `run_in_background` calls in the foreground, while explicit `true` returns a parent-owned Job id for `job_output` or `job_kill`. The base host and full presets already provide the generic Job registry and controls.

The standalone composition below shows the complete explicit capability. A Profile based on `@deepseek-ai/dsh-base` keeps its existing Job rows, adds the product provider row, and enables the preset tool row instead of mounting duplicate Job services.

```yaml
- id: subagent-codex
  name: '@deepseek-ai/dsh-subagent-codex'
  config:
    env:
      OPENAI_API_KEY: !!js process.env.OPENAI_API_KEY

- id: jobs
  name: '@deepseek-ai/dsh-jobs-local'

- id: tool-jobs
  name: '@deepseek-ai/dsh-tool-jobs'

- id: tool-subagent-codex
  name: '@deepseek-ai/dsh-tool-subagent'
  config:
    provider: codex
    toolName: subagent_codex
    backgroundMode: one-shot
    maxDepth: provider-managed
```

## Product compatibility and evidence

The production wire intentionally implements only the app-server methods required by this one-shot contract. Development evidence is pinned to `@openai/codex@0.147.0` / `codex-cli 0.147.0`; the npm package is a test-only dependency, and deployments still supply `codex` on `PATH`.

## Model Experience

### Child request

#### What the model sees

The Codex child receives the standalone text blocks as one turn in a fresh ephemeral thread. Its workspace is the parent Session cwd, and its model, system instructions, tools, sandbox, and authentication come from the native Codex installation and configuration.

#### Token effect

The child pays for an independent Codex context and turn. Child tokens do not enter the parent's context.

#### KV Cache effect

Independent of the parent request cache. Reuse depends only on Codex's own provider, model, instructions, tools, and ephemeral-thread request.

### Parent scheduling and results, indirectly

#### What the model sees

Through `dsh-tool-subagent`, a foreground call gives the parent the selected final Codex answer or the consumer's exact error for a non-completed result. A background call first returns a Job id; the generic job controls later deliver a completion notice, expose the final answer and status through `job_output`, and let `job_kill` request cancellation. Codex commentary, reasoning, tool activity, stderr, workspace diffs, usage, and product ids are not copied into the parent Session.

#### Token effect

Foreground input grows by the retained final answer or error. Background input also includes the start acknowledgement, completion notice, and any `job_output`, `job_kill`, or later status results; child tokens still do not enter the parent context. This provider adds no parent tool schema by itself.

#### KV Cache effect

Append-only: foreground adds one result after the reusable parent prefix, while background appends the Job acknowledgement, notice, and later control or collection results. Background scheduling can add a notice-driven turn, but none of these messages rewrites the earlier prefix.

## Known Limitations and Deferred Work

- **One fresh process, thread, and turn per run** — there is no continuation, resume, pooling, progress stream, or product-session persistence.
- **Host-managed product installation and account state** — a missing or incompatible `codex`, configuration error, or authentication failure is surfaced as a startup or run error; the plugin provides no installer, login flow, or runtime version gate.
- **Compatibility is pinned by development evidence** — upgrading from the verified 0.147.0 protocol baseline requires regenerating upstream schema evidence and rerunning handshake, answer-selection, approval, cancellation, keyless real-product, and credentialed DeepSeek nonce tests.
- **No human approval path** — known unattended approval requests are denied and unknown server requests fail closed; deployments cannot configure an allow policy through this package.
- **Product payload is final text only** — reasoning, commentary, intermediate messages, tool traffic, usage, stderr, and workspace diffs remain product-local; generic Job ids, notices, and status come from the shared job runtime.
- **No optional shared capabilities** — output schemas, child personas, tool filtering, and harness depth enforcement are rejected by the shared service for this provider.
- **No wall-clock timeout or side-effect rollback** — the caller cancels long work, and files or external systems changed before cancellation are not restored.
