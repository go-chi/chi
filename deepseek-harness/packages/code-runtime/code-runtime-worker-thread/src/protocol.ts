/**
 * Versionless, structured-clone wire protocol between co-shipped host and worker code. The host
 * treats inbound traffic as hostile because model code can forge `parentPort` messages; the
 * worker trusts host replies.
 * @module @deepseek-ai/dsh-code-runtime-worker-thread/src/protocol
 */

import type { WorkerJsonWire } from './worker-json.ts'

/** What the host hands the worker at spawn, via `workerData`. */
export interface WorkerBootData {
  /** The type-stripped (plain JS) program body. */
  code: string
  /** Binding namespaces to materialize; functions themselves stay host-side. */
  namespaces: {
    global: string
    names: string[]
    errorClass?: { name: string; memberNameProperty: string }
  }[]
  /** Hard cap for the combined serialized outer logs plus completion value or failure diagnostic. */
  maxOutputBytes: number
}

/** Worker → host: one bridged binding call. */
interface CallMessage {
  type: 'call'
  /** Worker-issued correlation id; the host answers each id at most once and ignores duplicates. */
  id: number
  /** The namespace global the call targets. */
  global: string
  /** The function name within the namespace. */
  name: string
  /** The single argument as a flat lossless-JSON wire value. */
  args: WorkerJsonWire
}

/** Worker → host: captured text, streamed eagerly so output survives a mid-run termination (timeout, abort, OOM). */
interface LogMessage {
  type: 'log'
  text: string
}

/** Worker → host: worker-side capture or completion measurement exceeded the outer cap. */
interface OutputLimitMessage {
  type: 'output-limit'
}

/**
 * Worker → host: the program settled. `error` carries a program exception,
 * invalid completion, or output overflow (budgets, aborts, and substrate death
 * are observed host-side). `value` is present only on a clean completion that
 * produced one, as a flat wire value already lossless and admitted against
 * the remaining combined output cap. Logs are NOT carried here — they streamed
 * eagerly as {@link LogMessage}s.
 */
export interface DoneMessage {
  type: 'done'
  value?: WorkerJsonWire
  error?: { kind: 'exception' | 'invalid-output' | 'output-limit'; message: string }
}

/** Every message the worker sends. */
export type WorkerToHost = CallMessage | LogMessage | OutputLimitMessage | DoneMessage

/** Host → worker: the answer to one {@link CallMessage}. */
export type ReplyMessage =
  | { type: 'reply'; id: number; ok: true; value: WorkerJsonWire }
  | { type: 'reply'; id: number; ok: false; message: string }
