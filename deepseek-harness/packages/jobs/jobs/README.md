# @deepseek-ai/dsh-jobs

English | [中文](README.zh.md)

The background job registry contract (`ctx.jobs`). The abstract `JobRegistry` and its vocabulary types give long-running producers shared ids, owner isolation, reads, cancellation, waiting, notices, and cleanup under one contract; the process-local registry lives in [`dsh-jobs-local`](../jobs-local/README.md). Producer plugins extend `JobKindMap` with their opaque id namespace.

## Service contract

- `start(spec): JobId` validates the attached controller, spec, exact live owner, optional positive `outputLimitBytes`, and any provider-owned admission policy before calling the producer's `run()` once. A preflight rejection or starter throw leaves no job id or registered work; successful return commits without another failable step.
- `get(id, caller?)` and `list(caller?)` return non-consuming snapshots. Listing includes only caller-owned and unowned jobs.
- `read(id, caller?)` consumes the single cursor for stream jobs and reads terminal output idempotently for final-output jobs.
- `kill(id, caller?, reason?)` invokes producer cancellation before changing status. A cancellation throw leaves the job running; success changes it to `stopping` and marks terminal delivery reported.
- `wait(id, timeoutMs, caller?, signal?)` returns a terminal snapshot or the live snapshot at timeout. Aborting stops only the wait; settlement wins once it has committed terminal delivery to that waiter.
- `onJobDone(listener)` observes each terminal record with the exact owner. Listener throws and rejections are contained; listener work is not awaited.
- `onJobsChanged(listener)` observes visible-set changes — registration, every stopping transition (teardown's included, before it awaits a slow producer), settlement, owner-disposal removal, and the emptying service disposal commits — carrying only the owner whose set moved, or `undefined` when an unowned job changed and every caller's set moved with it. It is owner-granular because removal is a change no per-job record can express, and it is not a superset of `onJobDone`: it carries no delivery meaning and marks nothing reported. The registration binds to the calling fiber, so an observer mounted outside the registry still sees the disposal emptying.
- `attachController(name)` declares a job controller for its effect lifetime. `start()` fails before producer execution when no attached controller serves the spec's owner.

All three registrations are owner-relative, because one registry serves every composition in the process. A controller or listener registered from an unscoped context serves every owner; one registered under an agent composition's scope serves exactly the agents composed under it. So a composition that loads no controller cannot start background work on the strength of another composition's controls, and one settlement notifies only the listeners its owner's composition registered.

Owned access compares the job's `SessionId` with the caller's. Ids such as `bash-1` are predictable, so this fence is the boundary. Unowned jobs are open to callers and last until service disposal.

`outputLimitBytes` is producer-owned model-presentation policy carried unchanged into snapshots. A controller applies it after adding status or notice metadata; the registry does not rewrite producer output or invent a default for producers that omit it.

Implementations also owe the lifecycle semantics of the contract: registrations outlive producer and controller fibers, owner and service disposal cancel live work and await compliant producers, and settlement is first-wins — one terminal record, one round of contained listener notification, released waiters.

See the [job type catalog](../../../docs/subsystems/jobs.md), the [runtime Agent Note](../../../.agents/notes/implemented/architecture/2026-06-20-generic-long-running-tool-runtime.md), and the [seam Agent Note](../../../.agents/notes/implemented/architecture/2026-07-26-job-registry-seam.md).

## Model Experience

Indirectly, through producer plugins and [`dsh-tool-jobs`](../tool-jobs/README.md), which render job ids, output, status, cancellation, and completion notices.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **Stream output has one consuming cursor** — independent observers need a cursor or snapshot API.
- **Foreground work cannot be promoted** — producers choose foreground or background before starting.
- **The contract is in-process** — `JobStart.run()` passes callbacks and exact `Agent` objects; a durable or cross-process backend must reshape identity, restart, ownership, and observation semantics before it can implement this seam.
