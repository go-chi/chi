# dsh-timeout

English | [中文](README.zh.md)

The **timing-and-classification** half of a timeout — a zero-dependency library of pure functions (no runtime harness deps) shared by every capability that clamps a caller's timeout hint, arms a deadline, and later has to tell "timed out" apart from "cancelled".

It owns **no termination**. The signal it hands out only *notifies*; actually stopping the work stays in each capability, because that mechanism differs — bash SIGKILLs an OS process group, web tears down a `fetch` socket — and no shared layer can own all of them. This is the boundary the [Agent Note](../../../.agents/notes/implemented/architecture/2026-07-06-timeout-deadline-library.md) draws: share the timing/classification, keep the hard kill local.

It is a **library, not a service or plugin**: no `ctx`, registers nothing, holds no state, emits no events. A "timeout service" would have to understand how to stop every capability's work — exactly the knowledge a microkernel keeps out of shared layers.

## API

```ts
import { clampTimeout, deadline, idleWatchdog, MAX_TIMER_DELAY_MS, timeoutOf, TimeoutReason } from '@deepseek-ai/dsh-timeout'
```

| Export | Role |
|---|---|
| `clampTimeout(requested, def, max, name?)` | Validate the caller's optional positive-finite hint, fill from `def`, cap at `max`. Throws (with `name`) on a non-positive/non-finite hint. |
| `deadline(upstream, timeoutMs, code)` | Fuse `upstream` cancellation with a timeout into one `AbortSignal` (`AbortSignal.any`); the timeout carries a `TimeoutReason`. `[Symbol.dispose]` clears the timer. |
| `idleWatchdog(upstream, timeoutMs, code)` | Keep one stable fused signal and arm only while its guarded async-iterator `next()` is outstanding. Resolution disarms; later demand or `pulse()` activity rearms; disposal clears; concurrent demand rejects. |
| `MAX_TIMER_DELAY_MS` | Largest delay Node schedules without clamping it to one millisecond (`2_147_483_647`). Timer-owning config must not exceed it. |
| `timeoutOf(signal \| { reason }, code?)` | Recover the `TimeoutReason` from an aborted signal/error, else `undefined` — the timeout-vs-cancel classifier. Pass `code` to match only THIS deadline's timer (see nesting below). |
| `TimeoutReason` | The internal reason (`code` + `timeoutMs`) stamped on a timeout abort. Not a public error — providers translate it into their own error/field. |

## The `timeoutMs <= 0` sentinel

`0` is the **internal** "no timeout" value for backend-owned background work (bash `start()`): `deadline()` arms no timer and forwards only `upstream`; with no upstream either, it returns a never-aborting signal plus a no-op disposer, so every caller keeps one call shape. External request hints validate as **positive finite** via `clampTimeout` before they reach `deadline`, so `0` is never a model-/plugin-facing "disable timeout" value.

## Usage shape

```ts
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'

declare function runWork(options: { signal: AbortSignal }): Promise<unknown>

// Scope-lifetime consumer (foreground bash, one fetch): `using` disposes the timer.
export async function runWithDeadline(upstream: AbortSignal | undefined, timeoutMs: number): Promise<unknown> {
  using d = deadline(upstream, timeoutMs, 'BASH_TIMEOUT')
  const outcome = await runWork({ signal: d.signal })               // work listens on d.signal and terminates itself
  const timedOut = timeoutOf(d.signal, 'BASH_TIMEOUT') !== undefined // classify the first abort, scoped to OUR code
  const aborted = d.signal.aborted && !timedOut                     // mutually exclusive: timeout won, or cancel did
  return { outcome, timedOut, aborted }
}
```

The signal only *notifies* — the caller MUST attach its own termination (`d.signal.addEventListener('abort', kill)`, or hand `d.signal` to `fetch`). Racing a promise against a timer would resolve the tool-call while the child process or socket leaks on; handing out a signal forces a real termination path to exist.

Pass your own `code` to `timeoutOf` so classification composes under nesting. When `upstream` is itself a deadline signal, `AbortSignal.any` preserves its `TimeoutReason` if that timer fires first. Scoping to your code makes a foreign timeout read as an ordinary upstream cancel instead of claiming that the local timer expired.

For a streamed transport, create one `idleWatchdog`, pass its stable `signal` into the transport, and call `watchdog.next(iterator)` for each provider read. Call `watchdog.pulse()` when transport activity does not yield an iterator value. The interval must be positive, finite, and no greater than `MAX_TIMER_DELAY_MS`; Node otherwise clamps it to one millisecond. It measures only outstanding demand, so no timer runs while downstream code renders or otherwise waits before asking for the next chunk. The primitive still only notifies, so the transport must observe the stable signal; the DeepSeek and pi-ai adapters prove that timeout closes their real response body or SDK request.

## What does NOT get a timeout

Local file `read`/`write`/`edit` take no `timeoutMs`: file IO runs untimed because a deadline would kill work the OS will still finish. See [the filesystem subsystem page](../../../docs/subsystems/filesystem.md).

## Model Experience

Indirectly, through consumers such as `dsh-tool-call-timeout-policy`, which may replace a provider result with a retained timeout error or suppress a late result.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **Notification only** — a deadline cannot stop work that ignores its signal; every capability still needs its own socket/process/task termination path.
- **`timeoutMs <= 0` is internal vocabulary** — it disables the local timer only after an owning backend has resolved policy, never as a public model/plugin knob.
- **The first abort reason wins classification** — when an upstream cancellation beats the local timer, this layer cannot later report that its own timeout would also have elapsed.
- **An idle watchdog is not a total deadline** — it rearms per outstanding iterator demand and deliberately excludes consumer think time.
