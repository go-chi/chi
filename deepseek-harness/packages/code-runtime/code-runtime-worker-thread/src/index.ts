/**
 * Worker-thread code runtime: a fresh worker runs each host-type-stripped TypeScript program
 * and bridges bindings over its message port. This is containment, not a security boundary:
 * model code has bash-equivalent trust despite an empty environment, a heap cap, measured
 * event-loop busy-time and wall-time budgets, and termination that also stops synchronous loops.
 * @module @deepseek-ai/dsh-code-runtime-worker-thread
 */

import { Worker } from 'node:worker_threads'
import { stripTypeScriptTypes } from 'node:module'
import type { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { CodeRuntime, DUNDER_MEMBER, PORTABLE_RESERVED_WORDS, RESERVED_BINDING_GLOBALS, RESERVED_ERROR_MEMBERS } from '@deepseek-ai/dsh-code-runtime'
import type { CodeBindingNamespace, CodeJsonValue, CodeRunFailure, CodeRunRequest, CodeRunResult } from '@deepseek-ai/dsh-code-runtime'
import { snapshotJsonValue } from '@deepseek-ai/dsh-session'
import type { ReplyMessage, WorkerBootData, WorkerToHost } from './protocol.ts'
import { jsonStringBytesUpTo, jsonValueBytesUpTo, truncateJsonStringBytes } from './output-json.ts'
import { decodeWorkerJson, encodeWorkerJson } from './worker-json.ts'
import type { WorkerJsonWire } from './worker-json.ts'

/** Plugin config: every execution cap, changeable from `cordis.yml` (no hardcoded tunables). */
export interface Config {
  /**
   * Busy-time budget in milliseconds: the run fails with kind `'timeout'`
   * once the worker's MEASURED event-loop active time
   * (`worker.performance.eventLoopUtilization()`) exceeds this. Metering
   * measured busy time — not wall time, not host-side pending-call
   * bookkeeping — is what makes the budget both fair (a program awaiting a
   * slow tool accrues nothing) and ungameable (a hot loop accrues whether
   * or not a decoy dispatch is in flight).
   */
  computeMs?: number
  /**
   * Wall-clock ceiling in milliseconds; never pauses for anything. The
   * backstop for what busy-time cannot see (a program awaiting a promise
   * nobody will resolve). At most `2_147_483_647` (Node's maximum
   * `setTimeout` delay, about 24.9 days): a longer value is rejected at load
   * because `setTimeout` would clamp it to 1 ms.
   */
  maxWallMs?: number
  /**
   * Hard cap for serialized log-array, completion-value, and failure-message payloads;
   * fixed result-envelope syntax is excluded.
   */
  maxOutputBytes?: number
  /** The worker's max old-generation heap in MiB (`resourceLimits`); overflow kills the worker, surfacing as kind `'worker-exit'`. */
  maxOldGenerationSizeMb?: number
}

/** {@link Config} after schemastery fills the defaults (every field present). */
type ResolvedConfig = Required<Config>

/**
 * How often the host samples the worker's event-loop utilization for the
 * `computeMs` budget. An internal cadence, not config: the only effect of
 * the interval is budget-expiry granularity (a run can overshoot by up to
 * one interval), and nothing a deployment could tune here improves that
 * without burning host CPU.
 */
const ELU_POLL_INTERVAL_MS = 25

/** Smallest cap that can represent the counted payloads: an empty logs array plus an empty JSON failure message. */
const MIN_OUTPUT_BYTES = 4

/**
 * The seam's language-portable identifier subset (see
 * `CodeBindingNamespace.global`): no `$`, which is JS-only spelling — the same
 * namespace list must be usable against every backend regardless of language.
 */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * The shell a program is wrapped in for the type-strip, matching the
 * grammatical context it will execute in (an async function body, where
 * top-level `return` and `await` are legal — a bare module parse would
 * reject the `return`). Strip mode is position-preserving (removed syntax
 * becomes whitespace, nothing shifts), so the wrapper survives the strip
 * byte-identical and the body slices back out with the model's own
 * line/column positions intact.
 */
const STRIP_WRAP = { prefix: 'async function __dsh_program__() {\n', suffix: '\n}' } as const

/** One in-flight run's host-side state, tracked for disposal. */
interface LiveRun {
  worker: Worker
  settle(failure: CodeRunFailure): void
  finished: Promise<void>
}

/**
 * The worker entry path. Source runs unbuilt (`src/worker.ts`, loadable
 * directly on this repo's Node range via native type stripping — the file
 * is erasable-only with type-only relative imports); the built package
 * ships it as a sibling CommonJS bundle (`lib/worker.cjs`, its own tsdown
 * entry) because pkg's VFS Worker hook compiles string-path entries as
 * CommonJS.
 * The URL *pathname*'s extension says which world this module is in —
 * pathname, because dev-time module runners (vitest) may suffix
 * `import.meta.url` with a query string; relative resolution drops it. Worker
 * receives a filesystem string so pkg's VFS Worker hook can resolve it.
 */
/* v8 ignore next -- the './worker.cjs' arm is the built-lib world, unreachable unbuilt by construction; the built-lib e2e pins it. */
const WORKER_PATH = fileURLToPath(new URL(new URL(import.meta.url).pathname.endsWith('.ts') ? './worker.ts' : './worker.cjs', import.meta.url))

/** Render an unknown thrown value as a message, `Error` or not. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Resolve after a worker pipe emits all queued data, or closes/errors during termination. */
function waitForPipeDrain(stream: Readable): Promise<void> {
  if (stream.readableEnded || stream.destroyed) return Promise.resolve()
  return new Promise((resolve) => {
    const done = (): void => {
      stream.off('end', done)
      stream.off('close', done)
      stream.off('error', done)
      resolve()
    }
    stream.once('end', done)
    stream.once('close', done)
    stream.once('error', done)
    // Close the event-registration race if termination finished between the
    // initial state check and the listeners above.
    /* v8 ignore next -- this race cannot be scheduled deterministically between the adjacent state check and listener registration. */
    if (stream.readableEnded || stream.destroyed) done()
  })
}

/**
 * Runtime shape gate for inbound port traffic. The peer runs MODEL CODE and
 * can post anything — `null`, primitives, objects with poisoned fields — so
 * the compile-time `WorkerToHost` type means nothing here: everything is
 * re-validated and REBUILT field by field (a forged extra field never rides
 * along; a non-number call id can never be echoed into a reply). Junk returns
 * `undefined` and is dropped — a throw in the host's `message` listener would
 * crash the host process.
 */
function parseWorkerMessage(raw: unknown): WorkerToHost | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const m = raw as Record<string, unknown>
  switch (m.type) {
    case 'call': {
      if (typeof m.id !== 'number' || typeof m.global !== 'string' || typeof m.name !== 'string') return undefined
      return { type: 'call', id: m.id, global: m.global, name: m.name, args: m.args as WorkerJsonWire }
    }
    case 'log': {
      if (typeof m.text !== 'string') return undefined
      return { type: 'log', text: m.text }
    }
    case 'output-limit': return { type: 'output-limit' }
    case 'done': {
      if (m.error === undefined) return { type: 'done', ...m.value !== undefined ? { value: m.value as WorkerJsonWire } : {} }
      const error = m.error
      if (typeof error !== 'object' || error === null) return undefined
      const { kind, message } = error as Record<string, unknown>
      if ((kind !== 'exception' && kind !== 'invalid-output' && kind !== 'output-limit') || typeof message !== 'string') return undefined
      return { type: 'done', error: { kind, message } }
    }
    default: return undefined
  }
}


/** One run's combined outer-output ledger; binding values never enter it. */
class OutputLedger {
  private bytes = 2 // JSON serialization of the empty logs array: []
  private entries = 0

  constructor(private readonly maxBytes: number) {}

  /** Admit one exact log entry, or report that the hard cap was crossed. */
  admit(text: string, sink: string[]): boolean {
    const separatorBytes = this.entries > 0 ? 1 : 0
    const stringBytes = jsonStringBytesUpTo(text, this.maxBytes - this.bytes - separatorBytes)
    if (stringBytes === undefined) return false
    this.bytes += stringBytes + separatorBytes
    this.entries += 1
    sink.push(text)
    return true
  }

  /** Finalize a successful absent-or-JSON completion against the combined cap. */
  success(logs: string[], value?: CodeJsonValue): CodeRunResult {
    if (value !== undefined && jsonValueBytesUpTo(value, this.maxBytes - this.bytes) === undefined) return this.limit(logs)
    return { logs, ...value !== undefined ? { value } : {} }
  }

  /** Finalize a failure diagnostic, with output-limit taking precedence when combined bytes exceed the cap. */
  failure(logs: string[], error: CodeRunFailure): CodeRunResult {
    if (jsonStringBytesUpTo(error.message, this.maxBytes - this.bytes) === undefined) return this.limit(logs)
    return { logs, error }
  }

  /** Build the explicit output-limit failure while retaining a fitting prefix of the final log. */
  limit(logs: string[]): CodeRunResult {
    const fullMessage = `outer output exceeded ${this.maxBytes} bytes`
    // The fixed diagnostic is ASCII, so every character is one byte plus the quotes.
    const messageBytes = fullMessage.length + 2
    const retained: string[] = []
    let retainedBytes = 2
    const logBudget = this.maxBytes - messageBytes
    for (const text of logs) {
      const separatorBytes = retained.length > 0 ? 1 : 0
      const availableBytes = logBudget - retainedBytes - separatorBytes
      const stringBytes = jsonStringBytesUpTo(text, availableBytes)
      if (stringBytes !== undefined) {
        retained.push(text)
        retainedBytes += stringBytes + separatorBytes
        continue
      }
      const prefix = truncateJsonStringBytes(text, availableBytes)
      if (prefix.length > 0) {
        const prefixBytes = jsonStringBytesUpTo(prefix, availableBytes)
        /* v8 ignore next -- truncateJsonStringBytes guarantees its returned prefix fits the same budget. */
        if (prefixBytes === undefined) throw new Error('output ledger produced an oversized log prefix')
        retained.push(prefix)
        retainedBytes += prefixBytes + separatorBytes
      }
      break
    }
    const availableMessageBytes = this.maxBytes - retainedBytes
    const message = truncateJsonStringBytes(fullMessage, availableMessageBytes)
    return { logs: retained, error: { kind: 'output-limit', message } }
  }
}

/**
 * The shipped {@link CodeRuntime} backend (`ctx.codeRuntime`). Registers as
 * the `codeRuntime` service; every cap comes from validated config. See the
 * module doc for the containment model and the Service Definition's class JSDoc for
 * the contract this implements (error-as-field, hostile-peer port,
 * no cross-run state, dispose to quiescence).
 */
export class WorkerThreadCodeRuntime extends CodeRuntime {
  static Config: z<Config> = z.object({
    computeMs: z.number().default(60_000),
    maxWallMs: z.number().default(600_000),
    maxOutputBytes: z.number().default(67_108_864),
    maxOldGenerationSizeMb: z.number().default(512),
  })

  readonly language = 'typescript'
  readonly isolation = 'worker-thread'

  private readonly config: ResolvedConfig
  private readonly live = new Set<LiveRun>()
  private disposed = false

  constructor(ctx: Context, config: Config) {
    super(ctx)
    // Schemastery filled the defaults; the cast records that. Positivity is a
    // semantic check the schema's plain number type does not carry.
    this.config = config as ResolvedConfig
    for (const [key, value] of Object.entries(this.config)) {
      if (!(Number.isFinite(value) && value > 0)) throw new Error(`dsh-code-runtime-worker-thread: config.${key} must be a positive number, got ${String(value)}`)
    }
    if (!Number.isSafeInteger(this.config.maxOutputBytes) || this.config.maxOutputBytes < MIN_OUTPUT_BYTES) {
      throw new Error(`dsh-code-runtime-worker-thread: config.maxOutputBytes must be a safe integer of at least ${MIN_OUTPUT_BYTES}, got ${String(this.config.maxOutputBytes)}`)
    }
    // maxWallMs reaches setTimeout, which clamps any delay above
    // MAX_TIMER_DELAY_MS to 1 ms; the positivity check above accepts such a
    // value, so a 25-day ceiling would time the run out immediately.
    if (this.config.maxWallMs > MAX_TIMER_DELAY_MS) {
      throw new Error(`dsh-code-runtime-worker-thread: config.maxWallMs must be at most ${MAX_TIMER_DELAY_MS} (Node clamps a longer setTimeout delay to 1ms), got ${String(this.config.maxWallMs)}`)
    }
    ctx.effect(() => () => this.teardown(), 'worker code-runtime teardown')
  }

  /**
   * Dispose to quiescence: mark the service unusable, fail every in-flight
   * run as aborted, and AWAIT each worker's exit so no worker outlives the
   * fiber.
   */
  private async teardown(): Promise<void> {
    this.disposed = true
    const runs = [...this.live]
    for (const run of runs) run.settle({ kind: 'abort', message: 'runtime disposed' })
    await Promise.all(runs.map(run => run.finished))
  }

  /**
   * Execute one program in a fresh worker. Program outcomes — including a
   * type-strip syntax error, which never spawns a worker — resolve with
   * `result.error`; the method rejects only for Service Definition contract misuse (a disposed
   * runtime, an invalid binding namespace).
   * @param request - the program, its bindings, and the abort signal.
   * @returns the run's outcome per the seam contract.
   */
  async run(request: CodeRunRequest): Promise<CodeRunResult> {
    if (this.disposed) throw new Error('dsh-code-runtime-worker-thread: run() after disposal')
    const bindings = this.validateBindings(request)
    if (request.signal?.aborted) {
      return this.failureBeforeWorker({ kind: 'abort', message: String(request.signal.reason) })
    }

    let code: string
    try {
      const stripped = stripTypeScriptTypes(STRIP_WRAP.prefix + request.program + STRIP_WRAP.suffix)
      code = stripped.slice(STRIP_WRAP.prefix.length, stripped.length - STRIP_WRAP.suffix.length)
    } catch (error: unknown) {
      // A program that does not survive the type-strip (syntax error,
      // non-erasable syntax like `enum`) is a program failure, reported the
      // same way a thrown exception would be — and no worker ever spawns.
      return this.failureBeforeWorker({ kind: 'exception', message: messageOf(error) })
    }

    return await this.execute(request, code, bindings)
  }

  /** Apply the outer-output ledger to failures that occur before a worker owns one. */
  private failureBeforeWorker(error: CodeRunFailure): CodeRunResult {
    return new OutputLedger(this.config.maxOutputBytes).failure([], error)
  }

  /** Reject malformed binding globals or typed-error declarations as Service Definition contract misuse. */
  private validateBindings(request: CodeRunRequest): Map<string, CodeBindingNamespace> {
    const bindings = new Map<string, CodeBindingNamespace>()
    for (const namespace of request.bindings) {
      if (!IDENTIFIER.test(namespace.global) || PORTABLE_RESERVED_WORDS.has(namespace.global)) {
        throw new Error(`dsh-code-runtime-worker-thread: binding global ${JSON.stringify(namespace.global)} is not a usable identifier`)
      }
      // RESERVED_BINDING_GLOBALS is the seam's shared backend-owned set:
      // `console` is THIS backend's log-capture slot; the dunder entries exist
      // for the Python side — its seeded/wrapped slots plus the `__debug__`
      // compile-time constant — refused here too so the namespace list stays
      // portable across backends. The seam declaration is the single home for
      // why each entry is reserved.
      if (RESERVED_BINDING_GLOBALS.has(namespace.global)) {
        throw new Error(`dsh-code-runtime-worker-thread: reserved binding global ${JSON.stringify(namespace.global)}`)
      }
      if (bindings.has(namespace.global)) {
        throw new Error(`dsh-code-runtime-worker-thread: duplicate binding global ${JSON.stringify(namespace.global)}`)
      }
      bindings.set(namespace.global, namespace)
    }

    const errorClassNames = new Set<string>()
    for (const namespace of request.bindings) {
      const descriptor = namespace.errorClass
      if (!descriptor) continue
      if (!IDENTIFIER.test(descriptor.name) || PORTABLE_RESERVED_WORDS.has(descriptor.name)) {
        throw new Error(`dsh-code-runtime-worker-thread: binding error class ${JSON.stringify(descriptor.name)} is not a usable identifier`)
      }
      if (RESERVED_BINDING_GLOBALS.has(descriptor.name)) {
        throw new Error(`dsh-code-runtime-worker-thread: reserved binding global ${JSON.stringify(descriptor.name)}`)
      }
      if (bindings.has(descriptor.name) || errorClassNames.has(descriptor.name)) {
        throw new Error(`dsh-code-runtime-worker-thread: duplicate injected global ${JSON.stringify(descriptor.name)}`)
      }
      const member = descriptor.memberNameProperty
      if (member.length === 0 || RESERVED_ERROR_MEMBERS.has(member) || DUNDER_MEMBER.test(member)) {
        throw new Error(`dsh-code-runtime-worker-thread: binding error member property ${JSON.stringify(descriptor.memberNameProperty)} is not usable`)
      }
      errorClassNames.add(descriptor.name)
    }
    return bindings
  }

  /** Spawn the worker for one validated, type-stripped run and drive it to settlement. */
  private execute(
    request: CodeRunRequest,
    code: string,
    bindings: Map<string, CodeBindingNamespace>,
  ): Promise<CodeRunResult> {
    const bootData: WorkerBootData = {
      code,
      namespaces: [...bindings].map(([global, namespace]) => ({
        global,
        names: Object.keys(namespace.functions),
        ...namespace.errorClass ? { errorClass: namespace.errorClass } : {},
      })),
      maxOutputBytes: this.config.maxOutputBytes,
    }
    const worker = new Worker(WORKER_PATH, {
      workerData: bootData,
      // Model code gets NO ambient environment — stronger than the scrubbed
      // env the defensive-patterns rule requires for spawned commands.
      env: {},
      // Hermetic flags too: without this the worker inherits the host process's execArgv (a
      // test runner's or tsx's loader hooks), which a bare isolate with an empty environment
      // cannot satisfy.
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: this.config.maxOldGenerationSizeMb },
      // Backstop capture: the bootstrap patches JS-level writes into its own
      // ordered buffer, so these pipes normally stay silent; anything that
      // still arrives (native-level writes) is appended after the done logs.
      stdout: true,
      stderr: true,
    })

    return new Promise<CodeRunResult>((resolve) => {
      let settled = false
      const answered = new Set<number>()
      const logs: string[] = []
      const strayLogs: string[] = []
      const output = new OutputLedger(this.config.maxOutputBytes)
      let terminalOverride: CodeRunResult | undefined

      // Pipe and message-port delivery are independent. Continue bounded pipe
      // capture after a terminal message while worker termination drains bytes
      // that were already queued; `finish` materializes the result only after
      // termination completes.
      const captureStray = (chunk: Buffer): void => {
        /* v8 ignore next -- a second post-overflow chunk races immediate worker termination; the first overflow path is covered. */
        if (terminalOverride !== undefined) return
        const text = chunk.toString('utf8')
        if (!output.admit(text, strayLogs)) {
          const limited = output.limit([...logs, ...strayLogs, text])
          terminalOverride = limited
          finish(limited)
        }
      }
      worker.stdout.on('data', captureStray)
      worker.stderr.on('data', captureStray)

      // Exactly one outcome wins. Every path cleans up, terminates, and awaits the worker;
      // logs captured before timeout, abort, or failure remain in the result.
      let finishResolve!: () => void
      const finished = new Promise<void>((done) => { finishResolve = done })
      const finish = (finalize: CodeRunResult | (() => CodeRunResult)): void => {
        if (settled) return
        settled = true
        clearInterval(eluTimer)
        clearTimeout(wallTimer)
        request.signal?.removeEventListener('abort', onAbort)
        this.live.delete(live)
        // Let the poll phase deliver pipe bytes already queued independently
        // of the terminal port message before termination closes the streams.
        void new Promise<void>((resume) => { setImmediate(resume) }).then(async () => {
          const stdoutDrained = waitForPipeDrain(worker.stdout)
          const stderrDrained = waitForPipeDrain(worker.stderr)
          await Promise.all([worker.terminate(), stdoutDrained, stderrDrained])
          const result = terminalOverride ?? (typeof finalize === 'function' ? finalize() : finalize)
          finishResolve()
          resolve(result)
        })
      }

      const onDone = (message: WorkerToHost): void => {
        if (message.type !== 'done') return
        if (message.error) {
          const error = message.error
          finish(() => output.failure([...logs, ...strayLogs], error))
          return
        }
        if (message.value === undefined) {
          finish(() => output.success([...logs, ...strayLogs]))
          return
        }
        const value = decodeWorkerJson(message.value)
        if (value === undefined) {
          finish(() => output.failure([...logs, ...strayLogs], { kind: 'invalid-output', message: 'program completion must be lossless JSON' }))
        } else {
          finish(() => output.success([...logs, ...strayLogs], value))
        }
      }

      const onCall = (message: WorkerToHost): void => {
        if (message.type !== 'call' || settled) return
        // Hostile-peer rules: a duplicate id is ignored, an unknown name is
        // answered with a failure, and a binding throw/reject becomes the
        // program-side rejection — contained here, never a host crash.
        if (answered.has(message.id)) return
        answered.add(message.id)
        const reply = (payload: ReplyMessage): void => {
          if (settled) return
          // Canonical resolutions were snapshotted as lossless JSON before
          // this point, so this payload is structured-cloneable by contract.
          worker.postMessage(payload)
        }
        const record = bindings.get(message.global)?.functions
        // Own-property lookup only: a forged name like 'constructor' or
        // 'hasOwnProperty' must not walk the record's prototype chain and
        // reach a callable the consumer never declared.
        const fn = record && Object.hasOwn(record, message.name) ? record[message.name] : undefined
        if (typeof fn !== 'function') {
          reply({ type: 'reply', id: message.id, ok: false, message: `unknown binding ${JSON.stringify(`${message.global}.${message.name}`)}` })
          return
        }
        const args = decodeWorkerJson(message.args)
        if (args === undefined) {
          reply({ type: 'reply', id: message.id, ok: false, message: 'binding arguments must be lossless JSON' })
          return
        }
        void (async () => {
          try {
            const resolved = await fn(args)
            let value: CodeJsonValue | undefined
            try {
              value = snapshotJsonValue(resolved)
            } catch {
              value = undefined
            }
            if (value === undefined) {
              reply({ type: 'reply', id: message.id, ok: false, message: 'binding resolution must be lossless JSON' })
            } else {
              reply({ type: 'reply', id: message.id, ok: true, value: encodeWorkerJson(value) })
            }
          } catch (error: unknown) {
            reply({ type: 'reply', id: message.id, ok: false, message: messageOf(error) })
          }
        })()
      }

      worker.on('message', (raw: unknown) => {
        // Parse before touching: the peer can post ANY shape, and a throw in
        // this listener would crash the host process. Junk drops silently.
        const message = parseWorkerMessage(raw)
        if (!message) return
        if (message.type === 'log' && !settled && !output.admit(message.text, logs)) {
          const limited = output.limit([...logs, ...strayLogs, message.text])
          finish(limited)
          return
        }
        if (message.type === 'output-limit' && !settled) {
          const limited = output.limit([...logs, ...strayLogs])
          finish(limited)
          return
        }
        onCall(message)
        onDone(message)
      })
      worker.on('error', (error: Error) => {
        finish(() => output.failure([...logs, ...strayLogs], { kind: 'worker-exit', message: `worker error: ${error.message}` }))
      })
      worker.on('exit', (exitCode: number) => {
        finish(() => output.failure([...logs, ...strayLogs], { kind: 'worker-exit', message: `worker exited with code ${exitCode} before completing` }))
      })

      // The compute budget reads the worker's own measured busy time, so a
      // hot loop expires it no matter what dispatches are in flight, while a
      // program idling on a slow binding accrues nothing.
      const eluTimer = setInterval(() => {
        const elu = worker.performance.eventLoopUtilization()
        if (elu.active > this.config.computeMs) {
          finish(() => output.failure([...logs, ...strayLogs], { kind: 'timeout', message: `compute budget exhausted (${this.config.computeMs}ms busy)` }))
        }
      }, ELU_POLL_INTERVAL_MS)
      const wallTimer = setTimeout(() => {
        finish(() => output.failure([...logs, ...strayLogs], { kind: 'timeout', message: `wall-clock ceiling reached (${this.config.maxWallMs}ms)` }))
      }, this.config.maxWallMs)
      const onAbort = (): void => {
        finish(() => output.failure([...logs, ...strayLogs], { kind: 'abort', message: String(request.signal?.reason) }))
      }
      request.signal?.addEventListener('abort', onAbort, { once: true })

      const live: LiveRun = {
        worker,
        finished,
        settle: (failure: CodeRunFailure) => { finish(() => output.failure([...logs, ...strayLogs], failure)) },
      }
      this.live.add(live)
    })
  }
}

export default WorkerThreadCodeRuntime
