# Agent Note: Claude Code and Codex subagent backends

Status: implemented

English | [中文](2026-08-04-claude-code-and-codex-subagent-backends.zh.md)

## Problem

The named [`ctx.subagents`](2026-06-21-subagent-capability-seam.md) registry lets a parent agent delegate work without knowing how the child runs, but the harness needs first-party routes to the real Codex and Claude Code products. Each route must hand the product one self-contained task, let it work in the parent Session's workspace, return a final answer or an explicit failure or cancellation, and leave no managed product process behind.

The product integrations must not become second owners for task text, cwd, cancellation, result settlement, or process trees. Required evidence therefore separates three facts: a keyless real-product test proves the official integration, native authentication shape, deterministic answer, and teardown; a Loader composition test proves that the public package and documented tool configuration load without starting the product; and a credentialed e2e proves that the production provider and real product can obtain a unique answer from the real DeepSeek service. Direct model HTTP or a product double cannot replace either product-running tier, and a hand-mounted plugin cannot replace the Loader tier.

## Decision

The harness publishes two sibling one-shot provider packages: `codex` and `claude-code`. This note owns their product protocols, result mapping, and process lifecycle; the [production-install exclusion decision](../simplification/2026-08-12-production-dsh-excludes-product-subagent-providers.md) owns their explicit Profile installation and host-plane placement, and the [product one-shot background decision](2026-08-12-product-subagent-one-shot-background-tasks.md) owns the model-visible scheduling choice. Loading either provider starts no product process, and each tool accepts only a standalone text task; product selection remains deployment configuration.

Both providers report `inheritsParentContext: false`, advertise no optional start capabilities, and pass the parent Session cwd without copying the parent conversation. Their documented tools use `backgroundMode: 'one-shot'` and `maxDepth: 'provider-managed'`: the consumer keeps foreground collection as the default and may place the same run in the generic Job runtime, while recursion policy stays with the out-of-process product. Every call creates a fresh product process and a non-resumable product conversation. `ctx.subagents` owns named-request resolution and paired lifecycle events; `dsh-tool-subagent` owns model-visible scheduling and foreground-versus-Job adaptation; `ctx.jobs` and `dsh-tool-jobs` own Job ids, state, output, controls, notices, and parent-owner cancellation; each product provider owns native result mapping, while `dsh-subprocess` owns credential scrubbing, process-tree termination, and whole-tree exit observation.

```text
fixed tool -> dsh-tool-subagent -> ctx.subagents -> product provider -> product process
  foreground <- final product outcome
  background -> ctx.jobs / dsh-tool-jobs -> Job id / state / notice / controls
  both -> provider disposal -> dsh-subprocess -> whole-tree exit
```

### Ownership and lifecycle

| Layer | Owner | Responsibility | Observable result |
| --- | --- | --- | --- |
| Delegation lifecycle | `ctx.subagents` | Resolve the named provider request and pair lifecycle events around the published `SubagentRun` | Unsupported context or malformed input fails before a run is published; start and terminal events remain paired |
| Scheduling and adaptation | `dsh-tool-subagent` | Interpret `run_in_background`, choose foreground collection or one-shot Job registration, and map the shared stop reason | Foreground returns the product outcome; background returns a Job id after registration |
| Job state and control | `ctx.jobs` and `dsh-tool-jobs` | Own Job state, output, cancellation, owner cleanup, completion notices, and model-facing controls | The exact parent can collect, list, or stop background work and receives its completion notice |
| Native run and teardown | Product provider and `dsh-subprocess` | Produce one native result, close the product protocol, request best-effort native cancellation, and prove process-tree exit | Foreground return and Job settlement both wait for idempotent disposal and whole-tree exit |

## Codex provider

`@deepseek-ai/dsh-subagent-codex` registers the fixed `codex` provider and starts `codex app-server --stdio` from `PATH`. Its public configuration contains only an explicit `env` overlay and a positive finite `disposeGraceMs` no greater than the repository's shared `MAX_TIMER_DELAY_MS`. Installation, login, `CODEX_HOME`, model selection, base URL, sandbox, approval policy, and product-session settings remain native Codex or deployment responsibilities.

Before publication, the provider validates a non-empty text-only task, starts the managed app-server in the parent workspace, completes `initialize` → `initialized`, and creates an `ephemeral: true` thread. The published run owns exactly one `turn/start`; its thread and turn ids remain private and are never persisted in the parent Session.

`turn/completed` is the authoritative remote terminal fact. The latest `agentMessage` with `phase: "final_answer"` wins, and that selected message must contain nonblank text. When the product emits no explicit final phase, the latest message with `phase: null` is the compatibility fallback and must likewise be nonblank; commentary never replaces either answer. A failed turn with `error.codexErrorInfo: "contextWindowExceeded"` becomes `max-tokens`. A completed turn without an answer, every other failed or interrupted remote turn, malformed required fields in a recognized app-server frame, protocol closure, early process exit, or unknown server request becomes `error`; this version has no native refusal terminal and therefore produces no `refusal`. Local cancellation wins its race and remains `aborted`.

For command and file approvals, the unattended wire selects a non-approval decision offered by the request, preferring `cancel`; the stable 0.147.0 request shape without an offered-decision list falls back to `decline`. It grants no requested permissions for the turn, answers user-input requests with no answers, and declines MCP elicitation. A request with no legal unattended response, or any unknown server request, fails the run instead of waiting for a user interface the provider does not supply.

An unpublished startup failure closes the wire, terminates the acquired process tree, waits for exit, and then rejects `start()`. Published disposal best-effort interrupts a known turn, closes the wire, ends stdin, invokes the shared termination escalation, and waits for whole-tree exit. Result failure and teardown failure stay independently observable.

Codex 0.147.0 speaks the Responses protocol, while DeepSeek's public OpenAI-compatible endpoint speaks Chat Completions. The credentialed Codex e2e therefore uses a loopback-only, test-private bridge for one no-tool nonce request: real Codex sends Responses to the bridge, the bridge forwards the received bearer credential and extracted task to the fixed official DeepSeek endpoint, and it wraps the real text in the minimal Responses SSE lifecycle. The bridge is neither a production proxy nor evidence that Codex connects to DeepSeek Chat Completions natively.

## Claude Code provider

`@deepseek-ai/dsh-subagent-claude-code` registers the fixed `claude-code` provider and invokes `@anthropic-ai/claude-agent-sdk@0.3.220`. Before each run, the provider resolves the fixed `claude` name through the host subprocess execution world and passes that exact path as `pathToClaudeCodeExecutable`; the SDK therefore uses the native product that launched DSH rather than selecting its platform `optionalDependency`. A Windows `.cmd` or `.bat` path crosses `cmd.exe /v:off` as a quoted per-spawn environment expansion, so percent, ampersand, and exclamation path components remain data without changing the shared subprocess contract. The provider uses the official `query()` entrypoint and passes the SDK's `spawnClaudeCodeProcess` arguments, cwd, environment, and forwarded signal to `dsh-subprocess`; its private `SpawnedProcess` adapter exposes only the stream, event, kill, and exit facts the SDK requires.

The public configuration contains the same two deployment-owned values as the Codex sibling: an explicit `env` overlay and a positive finite `disposeGraceMs` no greater than the repository's shared `MAX_TIMER_DELAY_MS`. Each run creates its own `AbortController`, sets `persistSession: false`, and disables `AskUserQuestion`. The provider deliberately omits `settingSources`, so the SDK reads the host's normal user, project, and local Claude settings relative to the parent Session cwd. It neither copies nor filters those settings and does not create or modify login state. It supplies no `canUseTool`, elicitation, or dialog callback, so unattended interactions fail through the SDK rather than waiting for a user interface the provider does not own.

The provider publishes only after both the SDK `Query` and a live managed CLI handle exist. It consumes the complete SDK stream and completes only when a `result` message has `subtype: "success"`, `is_error: false`, and a nonblank `result`, and the iterator then ends normally. Every SDK error subtype, an error-marked success, a missing result, iterator failure, protocol failure, or process failure becomes `error`. SDK turn, budget, and structured-output limits are not token-window facts, and the SDK exposes no native refusal terminal, so this provider produces neither `max-tokens` nor `refusal`. Local cancellation wins and becomes `aborted`.

Startup rollback and published disposal close the SDK query, abort the per-run controller, invoke shared process-tree termination, and wait for whole-tree exit. `Query.close()` expresses graceful protocol intent but does not replace the subprocess owner's exit proof. Query-close failure, process failure, and teardown failure remain independently observable.

The credentialed Claude Code e2e uses the official DeepSeek Claude Code contract directly: the runtime-only DeepSeek key becomes `ANTHROPIC_AUTH_TOKEN`, the fixed official base gains `/anthropic`, and the main and subagent model variables select the documented DeepSeek models. It starts the production provider and real SDK/CLI, requires one random nonce as the complete answer, persists no credential in settings, and waits for every managed handle to exit.

## Distribution and evidence

Each product owns branch-complete package tests, a required keyless real-product spec, a Loader composition e2e, and a credentialed DeepSeek e2e. The keyless product tier uses the exact official distribution under test, a non-empty fake product key, an isolated temporary workspace and product home, and a loopback fixed-answer model. Missing product requests, wrong authentication, altered task text, a non-exact answer, a skipped real product, or a surviving managed handle fails the required test. The Loader tier boots the README-shaped explicit Profile configuration, verifies both fixed one-shot tools expose optional background scheduling alongside generic Job controls, and starts neither product process. The credentialed tier starts the same production provider and real product with a runtime-only key, requires a unique nonce from the fixed official DeepSeek service, and proves quiescence again; it self-skips only when a local operator supplied no key, while trusted CI preflights the secret.

The Codex evidence pins `@openai/codex@0.147.0` and `codex-cli 0.147.0`. Its real-product spec observes the exact Bearer key, original task, byte-exact final answer, unattended command rejection with no file side effect, local cancellation, and whole-tree exit. Production still supplies `codex` on `PATH`.

The Codex credentialed e2e registers the production provider, starts the same real app-server, and requests one random nonce through the test-private bridge described above. It fixes the external endpoint and model, stores no credential or request payload, requires exactly one completed upstream response, compares the trimmed product answer byte-for-byte with the nonce, and waits for every managed handle to exit.

The Claude Code evidence pins Agent SDK 0.3.220 and uses its platform-distributed Claude Code 2.1.220 CLI as the deterministic compatibility fixture, routed through the same native executable-resolution path production uses. Its real-product spec observes the exact `x-api-key`, original task, byte-exact final answer, inherited temporary host-setting marker, process failure, local cancellation, whole-tree exit, and a real Windows batch shim under a path containing percent, ampersand, and exclamation metacharacters. This evidence proves the official SDK/CLI integration path, not compatibility with every independently installed product version. The Loader and shipped-profile evidence resolve both product packages by name while starting neither product, and the provider suite proves that the SDK receives the executable resolved from the host `PATH`.

The Claude Code credentialed e2e maps the key and fixed official endpoint only in the provider's in-memory environment, uses the documented `deepseek-v4-pro[1m]` and `deepseek-v4-flash` model variables, and traverses the production provider, official SDK, and real CLI. It compares the trimmed result with a random nonce and proves whole-tree exit without calling the Messages API directly from the test.

The project owner's distribution authorization is scoped to the official `@anthropic-ai/claude-agent-sdk` identity and the official Claude Code CLI/platform payloads each SDK version declares through `optionalDependencies`. [`THIRD_PARTY_NOTICES.md`](../../../../THIRD_PARTY_NOTICES.md) derives and discloses the current payload set without reclassifying its declared terms as permissive. Version, license-field, and payload-set changes still undergo ordinary dependency, lockfile, compatibility, terms, and notices review; unrelated non-permissive runtime packages continue to fail closed.

## Alternatives considered

**Direct model HTTP, `codex exec`, or a hand-written Claude CLI protocol.** These paths bypass the products' official extensible integration surfaces and cannot prove native configuration, tools, approvals, result semantics, or teardown. Each provider uses its official product integration instead.

**A shared product-process helper package.** The existing subagent and subprocess seams already own every shared task, result, environment, and process-tree concern. A new helper would duplicate ownership without deleting either private product adapter, so each adapter calls the existing seams directly.

**A model-visible product selector.** Product availability and authentication are deployment facts. Two fixed tools keep each schema and provider binding explicit and avoid adding dynamic selection state to the common service.

**Product doubles as required evidence.** Doubles cover exhaustive private protocol branches but do not prove package exports, official distributions, authentication, or real process behavior. Required evidence drives each official product against a loopback model fixture.

**Plugin-managed login, product home, models, settings, or permissions.** Those choices would create another authority beside each product's native configuration and enlarge a one-shot provider into account management. The providers expose only an explicit environment overlay and teardown grace; unattended interaction fails closed.

**Continuation, progress, product-native background state, and shared parent context.** The provider payload remains one final answer for one self-contained task. The generic Job layer may add its id, status, notice, collection, and cancellation results, but product sessions, resume, follow-up, intermediate messages, parent transcript transfer, structured output, and provider-specific background state need separate user contracts and are not prebuilt.

## Consequences

Users delegate through two stable one-shot tools backed by the official product integrations. Explicit Profile installation and host-plane provider placement are owned by the [production-install exclusion decision](../simplification/2026-08-12-production-dsh-excludes-product-subagent-providers.md); per-Preset tool exposure and foreground-default optional Job scheduling are owned by the [product one-shot background decision](2026-08-12-product-subagent-one-shot-background-tasks.md). This note's provider lifecycle keeps native settings and behavior while shared services retain the sole ownership of job settlement and process-tree quiescence.

Every delegation pays for a fresh product process and independent model context. The product payload reaching the parent is final text only; background scheduling additionally exposes generic Job ids, status, completion notices, and collection or cancellation results. Product-native configuration makes behavior depend on the deployment's installed product, account state, and workspace settings. Credentialed e2e runs also spend external API quota and depend on the official DeepSeek endpoint; deterministic protocol, failure, cancellation, and approval coverage remains in the keyless tier. The providers do not resume sessions, stream progress, accept new human interaction, roll back tool or file side effects, or impose a wall-clock timeout.

Compatibility is pinned by package-level unit coverage, keyless real-product loopback tests, credentialed DeepSeek nonce tests, public Loader composition, built-package and NodeNext consumer checks, generated documentation and notices, and the repository CI matrix. A supported product or DeepSeek endpoint/model baseline change must refresh those facts; production performs no separate runtime version probe.
