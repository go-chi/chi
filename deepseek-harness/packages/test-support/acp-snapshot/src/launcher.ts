/**
 * Shared launcher for ACP tests that drive an agent subprocess over JSON-RPC
 * stdio. It owns source-or-built launch resolution, workspace environment,
 * stdout tee, SDK client, update collection, permission fallback, and process
 * shutdown so e2e and snapshot suites do not each reconstruct that boundary.
 *
 * @module @deepseek-ai/dsh-acp-snapshot/launcher
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import {
  ClientSideConnection,
  ndJsonStream,
  type Agent as AcpAgent,
  type Client,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
} from '@agentclientprotocol/sdk'
import { resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'

const EXIT_MARKER_GRACE_MS = 250

/** The source/built agent entry, leaf config, and workspace tsconfig an ACP test boots. */
export interface AgentUnderTest {
  /** The agent source bin entry (for example `packages/examples/acp-demo/src/bin.ts`). */
  binScript: string
  /** Explicit built-mode entry for fixtures whose source path is not under `src/`. */
  libBinScript?: string | undefined
  /** The leaf `cordis.yml` loaded by the bin. */
  configPath: string
  /** The repo tsconfig whose paths resolve unbuilt workspace imports. */
  tsconfigPath: string
}

/** Options for one ACP test subprocess. */
export interface AcpTestLaunchOptions {
  /** The agent composition to boot. */
  agent: AgentUnderTest
  /** Process cwd and default session-home root. */
  cwd: string
  /** Alternate leaf config for this launch. */
  configPath?: string
  /** Extra environment values layered over the parent environment. */
  env?: NodeJS.ProcessEnv
  /** Permission handler; omitted requests fail closed as `cancelled`. */
  requestPermission?: (params: RequestPermissionRequest) => Promise<RequestPermissionResponse>
}

/** A running ACP test process and its captured client-side outputs. */
export interface LaunchedAcpTestAgent {
  /** The child process, exposed for process-level assertions. */
  child: ChildProcessWithoutNullStreams
  /** Resolve when the OS spawns the child; reject with its asynchronous spawn failure. */
  spawned: Promise<void>
  /** The SDK connection backed by the child's stdio. */
  client: ClientSideConnection
  /** Session updates in receive order. */
  updates: SessionNotification['update'][]
  /** Decode all stdout bytes captured so far. */
  rawStdout(): string
  /** Decode all stderr chunks captured so far. */
  stderr(): string
  /** Resolve when a future session update matches the predicate. */
  waitForUpdate(match: (update: SessionNotification['update']) => boolean): Promise<SessionNotification['update']>
  /** Close the process and drain its streams and callbacks; rejects promptly if fallback termination is refused. */
  close(signal?: NodeJS.Signals): Promise<void>
}

/**
 * Boot an ACP agent subprocess and connect an SDK client to its stdio.
 *
 * @param options Agent paths, cwd, environment, and optional permission handler.
 * @returns The running process, connected client, captures, and shutdown handle.
 */
export function launchAcpTestAgent(options: AcpTestLaunchOptions): LaunchedAcpTestAgent {
  const { agent, cwd } = options
  const launch = resolveExampleLaunch({
    srcBin: agent.binScript,
    libBin: agent.libBinScript,
    configArgs: ['--config', options.configPath ?? agent.configPath],
    tsconfigPath: agent.tsconfigPath,
    env: {
      ...options.env,
      DSH_HOME: join(cwd, '.dsh'),
      DSH_AGENTS_HOME: join(cwd, '.agents'),
    },
  })
  const child = spawn(
    launch.command,
    launch.args,
    {
      cwd,
      env: { ...process.env, ...launch.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )
  // A spawn-level failure is an asynchronous `error` event. Observe it in the
  // same tick as spawn so a missing cwd or OS rejection cannot crash the test
  // runner, then make startup and shutdown surface the original error.
  // Keep observing after the first error: a fallback kill attempted during
  // shutdown may itself report another process error, which must not become an
  // unhandled EventEmitter error after the promise has already settled.
  const childFailure = new Promise<Error>(resolve => child.on('error', resolve))
  const spawned = Promise.race([
    new Promise<void>(resolve => child.once('spawn', resolve)),
    childFailure.then((error): never => { throw error }),
  ])
  // `spawned` is public and close() also awaits it, but a caller may ignore both.
  // Keep that misuse from turning the already-observed child error into an
  // unhandled promise rejection.
  void spawned.catch(() => undefined)

  const stderrChunks: string[] = []
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => stderrChunks.push(chunk))

  const rawBuffers: Buffer[] = []
  const passthrough = new Readable({ read() {} })
  const updates: SessionNotification['update'][] = []
  const updateWaiters: {
    match: (update: SessionNotification['update']) => boolean
    resolve: (update: SessionNotification['update']) => void
    reject: (reason: unknown) => void
  }[] = []
  let updateStreamFailure: Error | undefined
  const closeUpdateStream = (): void => {
    if (updateStreamFailure !== undefined) return
    updateStreamFailure = new Error('ACP test agent update stream closed before a matching session update arrived')
    for (const waiter of updateWaiters.splice(0)) waiter.reject(updateStreamFailure)
  }
  child.stdout.on('data', (buffer: Buffer) => {
    rawBuffers.push(buffer)
    passthrough.push(buffer)
  })
  child.stdout.on('end', () => {
    passthrough.push(null)
  })
  const stream = ndJsonStream(
    Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
    Readable.toWeb(passthrough) as ReadableStream<Uint8Array>,
  )
  const inFlightClientCallbacks = new Set<Promise<unknown>>()
  const trackClientCallback = <T>(callback: () => T | PromiseLike<T>): Promise<T> => {
    const pending = Promise.resolve().then(callback)
    inFlightClientCallbacks.add(pending)
    const untrack = (): void => { inFlightClientCallbacks.delete(pending) }
    void pending.then(untrack, untrack)
    return pending
  }
  const requestPermission = options.requestPermission
    ?? (() => Promise.resolve({ outcome: { outcome: 'cancelled' as const } }))
  const makeClient = (_agent: AcpAgent): Client => ({
    sessionUpdate(params: SessionNotification): Promise<void> {
      return trackClientCallback(() => {
        updates.push(params.update)
        for (let index = updateWaiters.length - 1; index >= 0; index--) {
          const waiter = updateWaiters[index]
          /* v8 ignore next 1 -- index is bounded by the array length */
          if (waiter === undefined) continue
          let matches: boolean
          try {
            matches = waiter.match(params.update)
          } catch (error: unknown) {
            updateWaiters.splice(index, 1)
            waiter.reject(error)
            continue
          }
          if (!matches) continue
          updateWaiters.splice(index, 1)
          waiter.resolve(params.update)
        }
      })
    },
    requestPermission: params => trackClientCallback(() => requestPermission(params)),
  })
  const client = new ClientSideConnection(makeClient, stream)
  // `exit` only reports the parent process's status. Descendants may retain
  // inherited stdout/stderr handles and buffered ACP frames may still be
  // crossing the SDK parser. Node's `close` follows stdio closure; the SDK's
  // `closed` follows parser exhaustion. Capture both eagerly so a caller that
  // invokes close after process exit still joins the complete drain boundary.
  const stdioClosed = new Promise<void>(resolve => child.once('close', () => { resolve() }))
  const drained = Promise.all([stdioClosed, client.closed]).then(async () => {
    // The ACP SDK's readable loop dispatches client callbacks without awaiting
    // them. Once `closed` settles no new callbacks can start, but callbacks
    // already in flight still belong to this launch's teardown boundary.
    while (inFlightClientCallbacks.size > 0) {
      await Promise.allSettled([...inFlightClientCallbacks])
    }
  })
  // A caller may await a pending update without calling close(). Make natural
  // stream exhaustion terminal for those waiters too, but only after the
  // parser has dispatched every buffered frame.
  void client.closed.then(closeUpdateStream)

  return {
    child,
    spawned,
    client,
    updates,
    rawStdout: () => Buffer.concat(rawBuffers).toString('utf8'),
    stderr: () => stderrChunks.join(''),
    waitForUpdate(match): Promise<SessionNotification['update']> {
      if (updateStreamFailure !== undefined) return Promise.reject(updateStreamFailure)
      return new Promise((resolve, reject) => updateWaiters.push({ match, resolve, reject }))
    },
    async close(signal?: NodeJS.Signals): Promise<void> {
      try {
        await spawned
      } catch (error: unknown) {
        await drained
        closeUpdateStream()
        throw error
      }
      if (!isRunning(child)) {
        await drained
        closeUpdateStream()
        return
      }
      const exited = waitForExit(child)
      if (signal === undefined) child.stdin.end()
      else child.kill(signal)
      const failure = await Promise.race([
        exited.then((): undefined => undefined),
        childFailure,
      ])
      if (failure === undefined) {
        await drained
        closeUpdateStream()
        return
      }

      const propagateFailureAfterDrain = async (): Promise<never> => {
        await drained
        closeUpdateStream()
        throw failure
      }
      // Windows implements the supported signal names as forced termination. The exit markers
      // may therefore arrive after the error wins the race above but before fallback begins.
      if (!isRunning(child) || await exitMarkerWithinGrace(exited)) return propagateFailureAfterDrain()

      // An `error` after spawn is not an exit edge: in particular, a failed
      // signal can leave the subprocess live. Force termination, await the
      // already-observed exit edge, and only then propagate the child error so
      // callers may safely remove cwd/session resources after close rejects.
      const fallbackError = Promise.withResolvers<Error>()
      const observeFallbackError = (error: Error): void => { fallbackError.resolve(error) }
      child.once('error', observeFallbackError)
      if (!child.kill('SIGKILL')) {
        child.off('error', observeFallbackError)
        // A successful earlier signal may win between the live check and this fallback call.
        // In that case `kill()` correctly reports no process to signal; the original child error
        // remains the shutdown result once inherited stdio and callbacks have drained.
        if (!isRunning(child) || await exitMarkerWithinGrace(exited)) return propagateFailureAfterDrain()
        closeUpdateStream()
        throw new AggregateError(
          [failure, new Error('Fallback SIGKILL was not accepted by the child process')],
          'ACP test agent failed and fallback termination was refused',
        )
      }
      const fallbackFailure = await Promise.race([
        exited.then((): undefined => undefined),
        fallbackError.promise,
      ])
      child.off('error', observeFallbackError)
      if (fallbackFailure !== undefined) {
        closeUpdateStream()
        throw new AggregateError(
          [failure, fallbackFailure],
          'ACP test agent failed and fallback termination was refused',
        )
      }
      return propagateFailureAfterDrain()
    },
  }
}

/** Resolve once a running child exits. */
function waitForExit(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise<void>(resolve => child.once('exit', () => { resolve() }))
}

/** Give an accepted Windows termination request a bounded window to publish its exit marker. */
function exitMarkerWithinGrace(exited: Promise<void>): Promise<boolean> {
  return Promise.race([
    exited.then(() => true),
    new Promise<false>((resolve) => {
      const timer = setTimeout(() => { resolve(false) }, EXIT_MARKER_GRACE_MS)
      timer.unref()
    }),
  ])
}

/** Whether the child still lacks either OS termination marker. */
function isRunning(child: ChildProcessWithoutNullStreams): boolean {
  return child.exitCode === null && child.signalCode === null
}
