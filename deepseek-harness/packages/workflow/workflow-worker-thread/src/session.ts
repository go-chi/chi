/**
 * The worker-side half of the engine: {@link runWorkerSession} wires one MessagePort to one
 * {@link WorkflowExecution} — hook progress and child starts go out as messages, run control
 * and child lifecycle come back in — and posts the run's terminal result exactly once. Keeping it
 * separate from `worker.ts` lets unit tests drive the session over a MessageChannel, because main
 * process coverage cannot observe code inside a real Worker.
 *
 * The session announces ready and waits for `go`, so cancellation racing startup can prevent even
 * the script's synchronous prefix. A cancel in place of `go` releases the gate into a cancelled
 * drive without executing the body.
 * @module @deepseek-ai/dsh-workflow-worker-thread/session
 */

import type { MessagePort } from 'node:worker_threads'
import { assertNever } from '@deepseek-ai/dsh-llm'
import { HostToWorkerType, WorkerToHostType } from './protocol.ts'
import type { HostToWorkerMessage, WorkerToHostPayloads } from './protocol.ts'
import { renderThrown } from './realm.ts'
import { WorkflowExecution } from './runtime.ts'
import type { ExecutionObserver } from './runtime.ts'
import type {
  ChildHandle,
  ChildPort,
  ChildResult,
  ChildStartRequest,
  WorkerInit,
} from './types.ts'

/** The book-keeping for one in-flight child RPC (keyed by callId). */
interface PendingChild {
  started: PromiseWithResolvers<string>
  settled: PromiseWithResolvers<ChildResult>
  disposed: PromiseWithResolvers<void>
}

/** The typed post half of the port: each tag pairs with ITS payload from the map (a mismatch is a compile error at the call site). */
type Post = <T extends WorkerToHostType>(type: T, payload: WorkerToHostPayloads[T]) => void

/**
 * The worker-side handle for one started child agent ({@link ChildHandle}):
 * every member is an RPC to the host keyed by this call's `callId`, resolved
 * by the session's message handler through the bridge's pending entry.
 */
class RpcChildHandle implements ChildHandle {
  readonly result: Promise<ChildResult>

  constructor(
    private readonly post: Post,
    private readonly callId: number,
    private readonly entry: PendingChild,
    readonly id: string,
  ) {
    this.result = entry.settled.promise
  }

  dispose(): Promise<void> {
    this.post(WorkerToHostType.ChildDispose, { callId: this.callId })
    return this.entry.disposed.promise
  }
}

/**
 * The worker-side child-RPC bridge ({@link ChildPort}): allocates callIds,
 * posts the start/dispose RPCs, and owns the per-call pending
 * book-keeping the session's message handler settles via the `onChild*`
 * entry points.
 */
class ChildRpcBridge implements ChildPort {
  private nextCallId = 0
  private readonly pending = new Map<number, PendingChild>()

  constructor(private readonly post: Post) {}

  async startAgent(request: ChildStartRequest): Promise<ChildHandle> {
    this.nextCallId += 1
    const callId = this.nextCallId
    const entry: PendingChild = {
      started: Promise.withResolvers<string>(),
      settled: Promise.withResolvers<ChildResult>(),
      disposed: Promise.withResolvers<void>(),
    }
    // Containment: when asynchronous provider start fails (or
    // the run is torn down), the settled promise may never gain a consumer —
    // it must not surface as an unhandled rejection and kill the worker.
    entry.settled.promise.catch(() => { /* consumed: unconsumed child settlement after failed start */ })
    this.pending.set(callId, entry)
    this.post(WorkerToHostType.ChildStart, { callId, request })
    const childId = await entry.started.promise
    return new RpcChildHandle(this.post, callId, entry, childId)
  }

  /** The host established a published child; releases the `startAgent` await. */
  onChildStarted(callId: number, childId: string): void {
    this.pending.get(callId)?.started.resolve(childId)
  }

  /** Asynchronous provider start failed; reject and retire the pending RPC. */
  onChildStartError(callId: number, rendered: string): void {
    const entry = this.pending.get(callId)
    this.pending.delete(callId)
    entry?.started.reject(new Error(rendered))
  }

  /** The child's terminal result arrived. */
  onChildSettled(callId: number, result: ChildResult): void {
    this.pending.get(callId)?.settled.resolve(result)
  }

  /** The child's `result` rejected host-side (an infrastructure fault, relayed as fatal). */
  onChildFailed(callId: number, rendered: string): void {
    this.pending.get(callId)?.settled.reject(new Error(rendered))
  }

  /** The host acked the dispose; the call's book-keeping is complete. */
  onChildDisposed(callId: number): void {
    const entry = this.pending.get(callId)
    this.pending.delete(callId)
    entry?.disposed.resolve()
  }
}

/**
 * Narrow the nullable `parentPort` the bootstrap reads from
 * `node:worker_threads`.
 * @param port - `parentPort` as imported (null on the main thread).
 * @returns the port, non-null.
 */
export function requireParentPort(port: MessagePort | null): MessagePort {
  if (port === null) throw new Error('the workflow worker entry must be loaded inside a worker thread (no parentPort)')
  return port
}

/**
 * Run one workflow script to settlement against `port`, posting the terminal result message
 * exactly once; resolves after that post (stray children may still be winding down through the
 * port — the host owns their teardown and ultimately terminates the thread). It never rejects:
 * constructor failure becomes an error result. Host pre-parse makes syntax failure here a likely
 * Node-version skew, but the session still reports it instead of dying silently.
 * @param port - the channel to the host (the real `parentPort`, or one side
 *   of an in-process `MessageChannel` in tests).
 * @param init - the run payload the host provided as `workerData`.
 */
export async function runWorkerSession(port: MessagePort, init: WorkerInit): Promise<void> {
  const post: Post = (type, payload) => {
    port.postMessage({ type, ...payload })
  }
  const children = new ChildRpcBridge(post)

  const observer: ExecutionObserver = {
    phase: (title) => { post(WorkerToHostType.Phase, { title }) },
    log: (message) => { post(WorkerToHostType.Log, { message }) },
    agentStart: (info) => { post(WorkerToHostType.AgentStart, { info }) },
    agentEnd: (info) => { post(WorkerToHostType.AgentEnd, { info }) },
  }

  let execution: WorkflowExecution
  try {
    execution = new WorkflowExecution(init.meta, init.body, init.args, init.limits, observer, children)
  } catch (error: unknown) {
    post(WorkerToHostType.Result, { result: { value: null, stopReason: 'error', error: renderThrown(error), agentsStarted: 0 } })
    return
  }

  const gate = Promise.withResolvers<void>()
  port.on('message', (message: HostToWorkerMessage) => {
    switch (message.type) {
      case HostToWorkerType.Go:
        gate.resolve()
        break
      case HostToWorkerType.Cancel:
        execution.cancel(message.reason)
        // A cancel doubles as the gate release: drive() checks the cancelled
        // state before running the body, so the script never executes.
        gate.resolve()
        break
      case HostToWorkerType.ChildStarted:
        children.onChildStarted(message.callId, message.childId)
        break
      case HostToWorkerType.ChildStartError:
        children.onChildStartError(message.callId, message.rendered)
        break
      case HostToWorkerType.ChildSettled:
        children.onChildSettled(message.callId, message.result)
        break
      case HostToWorkerType.ChildFailed:
        children.onChildFailed(message.callId, message.rendered)
        break
      case HostToWorkerType.ChildDisposed:
        children.onChildDisposed(message.callId)
        break
      /* v8 ignore next 2 -- closed engine-owned union; the arm only makes adding a message type a compile error */
      default:
        assertNever(message, 'host-to-worker message')
    }
  })

  post(WorkerToHostType.Ready, {})
  await gate.promise
  const result = await execution.drive()
  post(WorkerToHostType.Result, { result })
}
