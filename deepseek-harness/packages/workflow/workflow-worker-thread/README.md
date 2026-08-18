# @deepseek-ai/dsh-workflow-worker-thread

English | [中文](README.zh.md)

This package implements `WorkflowEngine` with one Node worker thread per run. The worker executes the orchestration script; child agents remain on the host and are reached through `ctx.subagents` over a typed host/worker protocol.

The package root exports the default engine plugin and its `Config`; the worker protocol, runtime, and session modules stay private to the implementation. The operational `./worker` entry remains the engine's spawn target.

The split has one primary purpose: a synchronous script loop cannot block the harness event loop, and a script that ignores cancellation can be terminated with its worker. It is not a security sandbox.

## Trust and isolation boundary

Workflow scripts are model-written and have the same trust premise as the model's existing bash access. `node:vm` inside a worker is an API-shaping mechanism, not a security boundary: an escaped script can recover Node capabilities with the host process's privileges.

The worker still provides useful containment:

- Script CPU work and synchronous spins stay off the host event loop.
- `worker.terminate()` gives disposal a real final stop.
- The worker starts with an empty environment, except unbuilt loader plumbing, so ambient credentials do not cross through `process.env`.
- Host/worker messages use structured-clone data, with plain-JSON validation at the script boundary.

A genuinely untrusted-script sandbox would require a different engine behind the same workflow seam.

## Script contract

The workflow's `meta` is host-provided data, not evaluated script text. The engine validates its required `name` and `description`, rejects unknown fields, and parse-checks the body before returning a run.

Inside the worker, the script receives `args` and these hooks:

- `agent(prompt, { label, phase, schema, model })` starts one host-side subagent. With a schema it returns the structured value; otherwise it returns final text. An ordinary failed child yields `null`.
- `parallel(thunks)` runs thunks under the configured concurrency limit.
- `pipeline(items, ...stages)` passes `(previous, item, index)` without a cross-stage barrier.
- `phase(title)` and `log(message)` emit observer narration.

Unknown options, malformed arguments, unsupported schemas, tripped caps, provider-start failures, and infrastructure result failures are fatal workflow errors. No timers, filesystem API, or Node globals are intentionally injected, though the trust caveat above still applies.

## Run sequence

`start()` validates meta, parses the body, resolves a registered normalized provider route, and resolves any per-run total-child cap before creating a worker or publishing `workflow/start`. A requested `maxTotalAgents` must be a positive safe integer no greater than the engine's configured deployment ceiling. Source mode installs TypeScript transforms through a data-URL bootstrap; built mode passes sibling `lib/worker.cjs` as a filesystem path because pkg's VFS hook expects CommonJS. Both work under ordinary Node. A ready/go handshake prevents a start-signal cancellation racing worker boot from executing the script's initial synchronous slice.

For each `agent()` call:

1. The worker sends `child-start` with a plain-data prompt and options.
2. The host calls the start request's provider override, or otherwise the configured provider, through async `SubagentRuntime.start`, passing the workflow's parent and one canonical per-run abort signal. Provider choice applies to every child in that run and is not visible to the script.
3. If start rejects, the host sends `child-start-error`; provider startup has already reached quiescence and no child lifecycle event is emitted.
4. If start fulfills while the workflow still admits work, the host records the run, observes `result`, then sends `child-started`. Even an already-settled result is forwarded afterward, preserving start-before-result order.
5. The worker emits paired `workflow/agent-start` and `workflow/agent-end` narration and requests child disposal after collection.

Provider starts are tracked separately from published children. If cancellation, worker death, or normal workflow settlement closes admission while a start is pending, the shared signal aborts it. A provider that nevertheless fulfills after closure is disposed by the host and never announced to the worker.

## Value boundary

Values leaving the script pass through `materializeFromRealm`, which accepts plain, lossless JSON data and rejects exotic prototypes, functions, symbols, cycles, sparse arrays, non-finite numbers, and nested `undefined`. The walk runs in the worker, and defines object keys as data properties so `__proto__` cannot mutate a prototype.

Child results are projected and snapshotted before crossing from the host to the worker. This is a real process-like serialization boundary; it is deliberately different from trusted same-process workflow and subagent event payloads, which are borrowed immutable values.

## Cancellation and disposal

`WorkflowRun.cancel()` records the first reason, tells the worker to cancel, aborts the one signal shared by every pending and published child, and arms the `disposeGraceMs` timer. Worker hooks then throw `CANCELLED` at their next await. If the run remains unsettled at the deadline, the host resolves it as cancelled, pairs stranded child lifecycle events, and terminates the worker.

The subagent seam has one cancellation channel: the request signal. There is no separate child-cancel RPC. Published child teardown uses `run.dispose()`; pending provider starts remain provider-owned until their promise rejects or fulfills.

Normal settlement also aborts pending starts and begins disposing any published fire-and-forget children before the result becomes externally settled. The host's quiescence condition includes both pending starts and published child disposals, so cleanup does not forget an async startup transaction.

`dispose()` is idempotent. It cancels the run, starts host-driven disposal immediately, waits for result plus child quiescence up to the same grace, terminates the worker unconditionally, and performs a final survivor sweep. Per-child disposal is memoized so worker RPC, host cancellation, death cleanup, and public disposal all join one operation.

## Outcome and event guarantees

Terminal outcome is first-wins at host claim points. An accepted external cancellation overrides a later non-cancelled worker result; a result or worker death that claims first cannot be rewritten by reentrant cleanup callbacks.

Worker error, message failure, or premature exit closes message admission before cleanup, then resolves `error` unless cancellation already owns the run. Late queued messages cannot create children or narrate after that logical boundary.

The host keeps a ledger of forwarded child starts. A graceful worker supplies their ends; death or force termination synthesizes any missing end as cancelled. Every forwarded `workflow/agent-start` is therefore paired exactly once, although cleanup after an already-arrived workflow result may complete afterward.

## Config

| Key | Default | Meaning |
|---|---|---|
| `provider` | `spawn` | Host-side subagent provider used by `agent()`. |
| `maxConcurrentAgents` | `0` | Concurrent `agent()` ceiling; `0` resolves from available CPU parallelism. |
| `maxTotalAgents` | `1000` | Total `agent()` calls in one run. |
| `maxItemsPerCall` | `4096` | Items accepted by one `parallel()` or `pipeline()` call. |
| `syncTimeoutMs` | `5000` | VM timeout for the script's initial synchronous slice. |
| `disposeGraceMs` | `5000` | Bound before force-settlement/termination and for public disposal. |

An owning consumer may set `WorkflowStartRequest.subagentProvider` and `WorkflowStartRequest.maxTotalAgents` for one run. These are engine-level policy, not script hooks or model-facing options; the ordinary `workflow` tool leaves both unset. A per-run total-child cap may lower but never raise the configured `maxTotalAgents` ceiling.

## Model Experience

### Child-agent requests

#### What the model sees

Every script `agent()` call sends its prompt verbatim and optional model or structured-output schema to a subagent provider. Each child sees that provider's own context; phase and log narration stays on observer events.

#### Token effect

Potentially many independent child contexts are paid, bounded by `maxConcurrentAgents`, `maxTotalAgents`, and `maxItemsPerCall`; they never join the parent history directly.

#### KV Cache effect

Independent of the parent request cache and of sibling children. Each child can reuse only a byte-identical prefix under its own provider, model, prompt, and schema; its later history grows append-only.

### Parent tool result, indirectly

#### What the model sees

Through [`dsh-tool-workflow`](../tool-workflow/README.md), success exposes only the materialized final JSON value and child count in that consumer's wrapper. This engine supplies stable errors including `workflow script does not parse: <error>`, `invalid meta: <violations>`, `agent() requires a non-empty prompt string`, `agent() could not start a child: <error>`, `child agent run failed: <error>`, and its exact `parallel()`, `pipeline()`, `phase()`, option, schema, and JSON-boundary validation messages. Intermediate child outputs are available to the script but not the parent model.

#### Token effect

Zero direct parent tokens from this engine. Final result size is capped by the tool consumer and retained until compaction.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **The worker/vm is not a security boundary** — model-written code can escape `node:vm` and reach the worker's process authority; a hostile-code deployment needs a separate-process or container engine.
- **One worker thread is paid per run** — there is no pool, warm runtime, or cross-run script cache.
- **No ambient timers, filesystem, or network are injected, but escaped code can still reach Node** — the missing globals are portability API, not containment.
- **Termination can only report host-observed starts** — `agentsStarted` excludes worker-side calls still queued behind concurrency when a forced termination makes them unknowable.
- **Cross-realm errors fail `instanceof Error` inside scripts** — workflow authors must branch on stable fields such as `name` and `code`.
