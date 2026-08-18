/**
 * Fresh-process SDK subagent client. Drives one child DeepSeek Harness
 * runtime over stdio JSON-RPC through `@deepseek-ai/dsh-sdk-client` and owns
 * cancellation and quiescent disposal. Structure mirrors the ACP backend
 * (`@deepseek-ai/dsh-subagent-acp`): publish after the child handshake,
 * flatten child failures into stop reasons, tear down to quiescence. The
 * child is spawned BY the SDK client rather than through `ctx.subprocess` —
 * the subprocess seam's documented exception for SDK-managed transports —
 * so this driver applies the seam's shared env scrub itself.
 *
 * @module @deepseek-ai/dsh-subagent-dsh-sdk/run
 */

import { randomUUID } from 'node:crypto'
import { DeepSeekHarness, type HarnessNotification } from '@deepseek-ai/dsh-sdk-client'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent, type TurnEndReason } from '@deepseek-ai/dsh-session'
import type { SubagentResult, SubagentRun, SubagentStartRequest, SubagentStopReason } from '@deepseek-ai/dsh-subagent'
import { AssistantOutputFold, settleRunResult, subprocessRunHandle } from '@deepseek-ai/dsh-subagent'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'

/** Resolved spawn spec for an SDK runtime child process (no defaults — see Config). */
export interface SdkRunSpec {
  /** The executable to spawn (the child runtime — a `dsh-jsonrpc-agent` bin or packaged exe). */
  command: string
  /** Arguments passed to {@link command} (typically the child's `cordis.yml` path). */
  args: string[]
  /**
   * Absolute working directory for the child process AND the workspace cwd
   * of its SDK session. The provider resolves it before this spec exists:
   * config override, else the delegating parent session's workspace.
   */
  cwd: string
  /** Provider route the child runtime initializes with. */
  provider: string
  /** Model the child runtime initializes with. */
  model: string
  /** Optional per-request output-token cap sent in the child runtime's initialize handshake. */
  maxTokens?: number
  /**
   * Extra environment variables to ADD for the child (e.g. the child
   * runtime's own `DEEPSEEK_API_KEY`, or `DSH_CORDIS_CONFIG`). Merged after
   * the seam's `scrubbedParentEnv()` base, so an explicit credential or
   * current `DSH_*` fact survives while ambient namesakes never leak.
   */
  env: Record<string, string>
  /** Bound (ms) on the protocol `shutdown` exchange during dispose. */
  shutdownTimeoutMs: number
  /** Grace period (ms) for the child's EOF-driven quiesce on dispose. */
  disposeEofGraceMs: number
  /** Termination confirmation window (ms), including forced exit on every platform. */
  disposeGraceMs: number
  /**
   * Sink for a child-level failure that the run flattened into a stop reason
   * (the seam contract forbids `result` rejecting). A throw from the sink
   * itself is contained. Optional — omitted in unit tests that assert the
   * stop reason directly.
   */
  onError?: (error: Error, stopReason: SubagentStopReason) => void
}

/** EOF grace for child flush and nested-process teardown; wider than the signal grace below. */
export const DEFAULT_DISPOSE_EOF_GRACE_MS = 6_000

/** Default POSIX grace between SIGTERM and SIGKILL on dispose (the `disposeGraceMs` config). */
export const DEFAULT_DISPOSE_GRACE_MS = 3_000

/** Default bound on the protocol `shutdown` exchange during dispose. */
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 1_000

/**
 * Map a child turn-end reason to a harness {@link SubagentStopReason}.
 * @param reason - the owned child run's final durable turn reason, or
 * `undefined` when it settled without running a turn.
 * @returns the harness equivalent; an absent or unknown reason maps to
 * `error`, so an unclean stop is never reported as `completed`.
 */
export function sdkStopReason(reason: TurnEndReason | undefined): SubagentStopReason {
  switch (reason?.kind) {
    case 'completed':
      return 'completed'
    case 'max-tokens':
      return 'max-tokens'
    case 'aborted':
      return 'aborted'
    // error / interrupted / disposed / a future merged variant /
    // no turn at all: the task did NOT finish cleanly — surface a generic
    // failure so the consumer maps it to an isError result.
    default:
      return 'error'
  }
}

/** Normalize an unknown thrown value to an Error (the catch binding is `unknown`). */
function toError(value: unknown): Error {
  // The catch only sees rejections from the SDK client, which are always
  // `Error`s; the `String(value)` arm is a defensive fallback for a non-Error
  // throw that the typed surfaces cannot produce.
  /* v8 ignore next */
  return value instanceof Error ? value : new Error(String(value))
}

/**
 * Start and publish one SDK runtime child after its `initialize` handshake.
 * Child failures resolve through the run result; startup failures reject
 * after process reap. Disposal shuts the runtime down and reaps it.
 * @param request - the start request; its signal is the cancellation channel.
 * @param spec - the resolved spawn spec: command/args/cwd, the child's
 * provider/model route, env, timeouts, and the optional error sink.
 * @returns the ready run handle for the child subprocess.
 */
export async function startSdkRun(request: SubagentStartRequest, spec: SdkRunSpec): Promise<SubagentRun> {
  if (request.signal.aborted) throw new Error('subagent request was aborted before the SDK child started')
  // The run id lives in the parent namespace; the child runtime's session id
  // (minted below, private to the wire) exists only inside the child process.
  const id = SessionId(randomUUID())

  const harness = new DeepSeekHarness({
    launch: {
      command: spec.command,
      args: spec.args,
      cwd: spec.cwd,
      env: { ...scrubbedParentEnv(), ...spec.env },
      shutdownTimeoutMs: spec.shutdownTimeoutMs,
      disposeEofGraceMs: spec.disposeEofGraceMs,
      disposeGraceMs: spec.disposeGraceMs,
    },
    cwd: spec.cwd,
    provider: spec.provider,
    model: spec.model,
    ...spec.maxTokens === undefined ? {} : { maxTokens: spec.maxTokens },
  })

  // Cancellation settles the result without waiting for a cooperative child.
  const flags = { cancelled: false }
  let signalCancelSettled!: () => void
  const cancelSettled = new Promise<void>((resolve) => { signalCancelSettled = resolve })
  const requestCancel = (): void => {
    if (flags.cancelled) return
    flags.cancelled = true
    signalCancelSettled()
  }
  const onAbort = (): void => { requestCancel() }
  request.signal.addEventListener('abort', onAbort, { once: true })

  // Establish the child handshake before publishing a handle. Any failure
  // owns the still-private process and reaps it before rejecting.
  try {
    await Promise.race([
      harness.start(),
      cancelSettled.then((): never => { throw new Error('subagent cancelled before the SDK child initialized') }),
    ])
    // Defensive: an abort() is a macrotask and no user callback runs inside
    // the microtask drain between handshake fulfillment and this continuation,
    // so the recheck is not schedulable today; it guards future reentrancy.
    /* v8 ignore next */
    if (flags.cancelled) throw new Error('subagent cancelled before the SDK child initialized')
  } catch (error: unknown) {
    request.signal.removeEventListener('abort', onAbort)
    await harness.close()
    if (flags.cancelled) throw new Error('subagent request was aborted before the SDK child started')
    throw toError(error)
  }

  const childSessionId = `session-${randomUUID().replaceAll('-', '')}`
  // The child's final answer under the seam's canonical selection rule
  // (`AssistantOutputFold`); a partial answer survives cancel and error paths.
  const fold = new AssistantOutputFold()
  const observe = (notification: HarnessNotification): void => {
    if (notification.method !== 'session.event' || notification.params.sessionId !== childSessionId) return
    fold.push(notification.params.event as SessionEvent)
  }
  const collectOutput = (): ContentBlock[] => fold.collect() ?? []

  // Race the child turn against local cancellation; the shared settlement
  // flattens failures under the seam's never-reject contract.
  const result: Promise<SubagentResult> = settleRunResult({
    attempt: async () => {
      const turn = await Promise.race([
        harness.session(childSessionId).run(request.prompt, { onNotification: observe }),
        cancelSettled.then(() => 'cancelled' as const),
      ])
      if (turn === 'cancelled') return { output: collectOutput(), stopReason: 'aborted' }
      const lastEnd = turn.events.findLast(
        (event): event is Extract<SessionEvent, { type: 'turn/end' }> => event.type === 'turn/end',
      )
      return { output: collectOutput(), stopReason: sdkStopReason(lastEnd?.data.reason) }
    },
    collectOutput,
    cancelled: () => flags.cancelled,
    onError: spec.onError,
    signal: request.signal,
    onAbort,
  })

  // There is no wire-level prompt cancel: dispose settles the result locally,
  // then the bounded shutdown request + dispose ladder tears the child down.
  return subprocessRunHandle({
    id,
    result,
    signal: request.signal,
    onAbort,
    requestCancel,
    teardown: () => harness.close(),
  })
}
