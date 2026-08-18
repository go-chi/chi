import { describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import type { Worker } from 'node:worker_threads'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type { SubagentCapabilities, SubagentProvider, SubagentResult, SubagentRun, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import type { WorkflowMeta, WorkflowResult, WorkflowResultInfo, WorkflowRun, WorkflowRunInfo } from '@deepseek-ai/dsh-workflow'
import * as workerEngineModule from '../src/index.ts'
import WorkerThreadWorkflowEngine, { type Config } from '../src/index.ts'
import { workerSpawnEnv } from '../src/host.ts'
import { HostToWorkerType, WorkerToHostType } from '../src/protocol.ts'
import { SessionId } from '@deepseek-ai/dsh-session'

/** A minimal parent stand-in: the engine only threads it through to the provider. */
function fakeParent(): Agent {
  return { id: SessionId('workflow-parent'), options: {} } as unknown as Agent
}

// Allow cold worker startup on contended CI runners.
vi.setConfig({ testTimeout: 30_000 })

/**
 * Wait up to 10 seconds for CPU-bound worker startup or cross-thread delivery on contended CI.
 * Host reactions after an observed event use explicit tight overrides, so this generous startup
 * allowance cannot hide multi-second reap regressions.
 */
function waitFor(assertion: () => void, timeout = 10_000): Promise<void> {
  return vi.waitFor(assertion, { timeout, interval: 50 })
}

/** The vm-context escape hatch, spelled once: real Worker tests use it to make the WORKER misbehave. */
const ESCAPE = "globalThis.constructor.constructor('return process')()"

/** One controllable child run: the test (or auto mode) settles it. */
interface ControlledRun {
  request: SubagentStartRequest
  /** Fulfill the provider's async start with a published child. */
  publish(): void
  /** Reject the provider's async start before ownership transfer. */
  rejectStart(error: unknown): void
  settle(result: SubagentResult): void
  rejectResult(error: unknown): void
  cancelled: string | undefined
  disposed: boolean
  disposeCalls: number
}

/**
 * A scripted in-test provider over the REAL SubagentRuntime registry: `auto`
 * settles each run via the reply function on a microtask; `manual` piles runs
 * up in `runs` for the test to settle. A run aborts (settles `aborted`) when
 * the request signal fires, like the real in-process backends.
 */
class StubProvider implements SubagentProvider {
  readonly capabilities: SubagentCapabilities = { outputSchema: true, depthLimit: true, toolFilter: true, persona: false }
  readonly inheritsParentContext = false
  readonly runs: ControlledRun[] = []

  constructor(
    readonly name: string,
    private readonly reply?: (request: SubagentStartRequest, index: number) => SubagentResult,
    private readonly disposeDelayMs = 0,
    private readonly deferStart = false,
    private readonly onAbortString?: (reason: string | undefined, index: number) => void,
    private readonly onSignalAbort?: (reason: unknown, index: number) => void,
  ) {}

  async start(request: SubagentStartRequest): Promise<SubagentRun> {
    const startGate = Promise.withResolvers<undefined>()
    const terminal = Promise.withResolvers<SubagentResult>()
    terminal.promise.catch(() => { /* provider owns early settlement until publication */ })
    let published = false
    const controlled: ControlledRun = {
      request,
      publish: () => { published = true; startGate.resolve(undefined) },
      rejectStart: (error) => { startGate.reject(error) },
      settle: (result) => { terminal.resolve(result) },
      rejectResult: (error) => { terminal.reject(error) },
      cancelled: undefined,
      disposed: false,
      disposeCalls: 0,
    }
    this.runs.push(controlled)
    const index = this.runs.length - 1
    request.signal.addEventListener('abort', () => {
      controlled.cancelled = String(request.signal.reason ?? 'cancelled')
      this.onAbortString?.(String(request.signal.reason ?? 'cancelled'), index)
      this.onSignalAbort?.(request.signal.reason, index)
      if (published) terminal.resolve({ output: [], stopReason: 'aborted' })
      else startGate.reject(new Error('child start aborted before publication'))
    }, { once: true })
    if (!this.deferStart) controlled.publish()
    if (this.reply) {
      const reply = this.reply
      queueMicrotask(() => { terminal.resolve(reply(request, index)) })
    }
    try {
      await startGate.promise
    } catch (error: unknown) {
      controlled.disposeCalls += 1
      controlled.disposed = true
      throw error
    }
    if (request.signal.aborted) throw new Error('child start aborted before publication')
    return {
      id: SessionId(`stub-child-${index}`),
      localAgent: undefined,
      result: terminal.promise,
      dispose: () => {
        controlled.disposeCalls += 1
        if (this.disposeDelayMs === 0) {
          controlled.disposed = true
          return Promise.resolve()
        }
        return new Promise<void>((resolve) => {
          setTimeout(() => {
            controlled.disposed = true
            resolve()
          }, this.disposeDelayMs)
        })
      },
    }
  }
}

/** Text-reply helper for auto providers. */
function text(reply: string): SubagentResult {
  return { output: [{ type: 'text', text: reply }], stopReason: 'completed' }
}

interface SetupOptions {
  config?: Config
  reply?: (request: SubagentStartRequest, index: number) => SubagentResult
  manual?: boolean
  disposeDelayMs?: number
  deferStart?: boolean
  onChildAbortString?: (reason: string | undefined, index: number) => void
  onChildSignalAbort?: (reason: unknown, index: number) => void
}

async function setup(options?: SetupOptions) {
  const ctx = new Context()
  await ctx.plugin(SubagentRuntime)
  const provider = new StubProvider(
    'stub',
    options?.manual ? undefined : options?.reply ?? (() => text('stub reply')),
    options?.disposeDelayMs ?? 0,
    options?.deferStart ?? false,
    options?.onChildAbortString,
    options?.onChildSignalAbort,
  )
  ctx.subagents.registerProvider(provider)
  // A fixed concurrency ceiling: the auto-resolved default is machine-derived
  // (cores - 2, floored at 1), so tests that expect N children in flight
  // would wedge on small CI runners.
  const engineFiber = await ctx.plugin(WorkerThreadWorkflowEngine, { provider: 'stub', maxConcurrentAgents: 8, ...options?.config })
  return { ctx, provider, parent: fakeParent(), engineFiber }
}

/** The standard test meta plus a body, spread into a start request. */
function scripted(body: string, metaExtra?: Partial<WorkflowMeta>): { script: string; meta: WorkflowMeta } {
  return { script: body, meta: { name: 'test-flow', description: 'a test workflow', ...metaExtra } }
}

/** Start + await one run, disposing on the way out. */
async function run(ctx: Context, parent: Agent, source: { script: string; meta: WorkflowMeta }, args?: unknown): Promise<WorkflowResult> {
  const handle = ctx.workflowEngine.start({ ...source, parent, ...args !== undefined ? { args } : {} })
  try {
    return await handle.result
  } finally {
    await handle.dispose()
  }
}

describe('dsh-workflow-worker-thread', () => {
  describe('script execution over a real worker thread', () => {
    it('runs a script end-to-end: agent() text results, phases, log, args, return value, events', async () => {
      const { ctx, parent, provider } = await setup({ reply: (_request, index) => text(`answer-${index}`) })
      const events: [string, unknown[]][] = []
      for (const name of ['workflow/start', 'workflow/phase', 'workflow/log', 'workflow/agent-start', 'workflow/agent-end', 'workflow/end'] as const) {
        ctx.on(name, (...payload: unknown[]) => { events.push([name, payload]) })
      }
      const result = await run(ctx, parent, scripted(`
        phase('Scan')
        log('starting with ' + args.files.length + ' files')
        const answers = await pipeline(args.files, (prev, item) => agent('read ' + item))
        phase('Report')
        return { answers, count: args.files.length }
      `, { phases: [{ title: 'Scan' }, { title: 'Report' }] }), { files: ['a.ts', 'b.ts'] })

      expect(result.stopReason).toBe('completed')
      expect(result.agentsStarted).toBe(2)
      expect(result.value).toEqual({ answers: ['answer-0', 'answer-1'], count: 2 })
      expect(provider.runs.every(r => r.disposed)).toBe(true)

      const names = events.map(([name]) => name)
      expect(names[0]).toBe('workflow/start')
      expect(names).toContain('workflow/phase')
      expect(names).toContain('workflow/log')
      expect(names.at(-1)).toBe('workflow/end')
      const info = events[0]![1][0] as WorkflowRunInfo
      expect(info.meta.name).toBe('test-flow')
      const end = events.at(-1)![1][1] as Record<string, unknown>
      expect(end).toEqual({ stopReason: 'completed', agentsStarted: 2 })
      expect('value' in end).toBe(false)
    })

    it('agent({schema, model}) forwards outputSchema and agentOptions to the provider across the thread', async () => {
      const { ctx, parent, provider } = await setup({
        reply: () => ({ output: [], structured: { files: ['x.ts', 'y.ts'] }, stopReason: 'completed' }),
      })
      const result = await run(ctx, parent, scripted(`
        const found = await agent('list files', { model: 'deepseek-v4-pro', schema: { type: 'object', properties: { files: { type: 'array', items: { type: 'string' } } }, required: ['files'] } })
        return { first: found.files[0], count: found.files.length }
      `))
      expect(result.value).toEqual({ first: 'x.ts', count: 2 })
      expect(provider.runs[0]!.request.outputSchema).toEqual({
        type: 'object',
        properties: { files: { type: 'array', items: { type: 'string' } } },
        required: ['files'],
      })
      expect(provider.runs[0]!.request.agentOptions).toEqual({ model: 'deepseek-v4-pro' })
      expect(provider.runs[0]!.request.parent).toBeDefined()
    })

    it('agent({provider}) forwards provider-only agentOptions across the thread', async () => {
      const { ctx, parent, provider } = await setup()
      const result = await run(ctx, parent, scripted("return await agent('route me', { provider: 'openai' })"))

      expect(result.value).toBe('stub reply')
      expect(provider.runs[0]!.request.agentOptions).toEqual({ provider: 'openai' })
    })

    it('a start-request provider override selects every child without changing the engine default', async () => {
      const { ctx, parent, provider } = await setup()
      const selected = new StubProvider('selected', () => text('selected reply'))
      ctx.subagents.registerProvider(selected)

      const overridden = ctx.workflowEngine.start({
        ...scripted("return await agent('route this run')"),
        parent,
        subagentProvider: 'selected',
      })
      expect((await overridden.result).value).toBe('selected reply')
      await overridden.dispose()
      expect(selected.runs).toHaveLength(1)
      expect(provider.runs).toHaveLength(0)

      const ordinary = await run(ctx, parent, scripted("return await agent('use the default')"))
      expect(ordinary.value).toBe('stub reply')
      expect(provider.runs).toHaveLength(1)
    })

    it('rejects invalid start-request provider routes before publishing a run', async () => {
      const { ctx, parent } = await setup()
      let starts = 0
      ctx.on('workflow/start', () => { starts += 1 })
      const messages: string[] = []
      for (const subagentProvider of ['', 'missing']) {
        let run: WorkflowRun | undefined
        let thrown: unknown
        try {
          run = ctx.workflowEngine.start({
            ...scripted("return 'must not start'"),
            parent,
            subagentProvider,
          })
        } catch (error: unknown) {
          thrown = error
        }
        await run?.dispose()
        messages.push(thrown instanceof Error ? thrown.message : '')
      }

      expect(messages).toEqual([
        'workflow subagentProvider must be a non-empty normalized string',
        'no subagent provider registered for "missing"',
      ])
      expect(starts).toBe(0)
    })

    it('rejects invalid per-run total-agent caps before publishing a run', async () => {
      const { ctx, parent } = await setup({ config: { maxTotalAgents: 2 } })
      let starts = 0
      ctx.on('workflow/start', () => { starts += 1 })
      const errors: unknown[] = []
      for (const maxTotalAgents of [0, 1.5, Number.NaN, 3]) {
        try {
          const handle = ctx.workflowEngine.start({
            ...scripted("return 'must not start'"),
            parent,
            maxTotalAgents,
          })
          await handle.dispose()
        } catch (error: unknown) {
          errors.push(error)
        }
      }

      expect(errors.slice(0, 3)).toEqual(Array(3).fill(expect.objectContaining({
        code: 'INVALID_ARGUMENT',
        message: 'workflow maxTotalAgents must be a positive safe integer',
      })))
      expect(errors[3]).toMatchObject({
        code: 'INVALID_ARGUMENT',
        message: 'workflow maxTotalAgents 3 exceeds the engine ceiling 2',
      })
      expect(starts).toBe(0)
    })

    it('enforces a per-run total-agent cap below the engine ceiling', async () => {
      const { ctx, parent } = await setup({ config: { maxTotalAgents: 2 } })
      const handle = ctx.workflowEngine.start({
        ...scripted("await agent('first'); await agent('second'); return 'unreachable'"),
        parent,
        maxTotalAgents: 1,
      })
      const result = await handle.result
      expect(result.stopReason).toBe('error')
      expect(result.agentsStarted).toBe(1)
      expect(result.error).toContain('total agent cap (1)')
      await handle.dispose()
    })

    it('a fatal hook error inside the worker kills the script and reports the error', async () => {
      const { ctx, parent } = await setup()
      const result = await run(ctx, parent, scripted("return await parallel([() => agent('x', { isolation: 'worktree' })])"))
      expect(result.stopReason).toBe('error')
      expect(result.error).toContain('"isolation" is deferred')
    })

    it('rejects an unregistered configured provider before publishing a run', async () => {
      const { ctx, parent } = await setup({ config: { provider: 'nonexistent' } })
      let thrown: unknown
      try {
        ctx.workflowEngine.start({ ...scripted("return 'must not start'"), parent })
      } catch (error: unknown) {
        thrown = error
      }
      expect(thrown).toMatchObject({
        code: 'AGENT_START',
        message: 'no subagent provider registered for "nonexistent"',
      })
    })

    it('waits for async provider start before announcing a result that settled early', async () => {
      const { ctx, parent, provider } = await setup({ manual: true, deferStart: true })
      const order: string[] = []
      ctx.on('workflow/agent-start', (_info, agent) => { order.push(`start:${agent.seq}`) })
      ctx.on('workflow/agent-end', (_info, agent) => { order.push(`end:${agent.outcome}`) })
      ctx.on('workflow/end', () => { order.push('run-end') })

      const handle = ctx.workflowEngine.start({ ...scripted("return await agent('p')"), parent })
      await waitFor(() => { expect(provider.runs.length).toBe(1) })
      const early = text('accepted value')
      provider.runs[0]!.settle(early)
      // The provider still owns this early result while start is pending.
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(order).toEqual([])

      provider.runs[0]!.publish()
      const result = await handle.result
      expect(result.value).toBe('accepted value')
      expect(order).toEqual(['start:1', 'end:completed', 'run-end'])
      await handle.dispose()
      expect(provider.runs[0]!.disposeCalls).toBe(1)
    })

    it('observes an early result rejection but sends ChildStarted before ChildFailed after start fulfills', async () => {
      const { ctx, parent, provider } = await setup({ manual: true, deferStart: true })
      const lifecycle: string[] = []
      ctx.on('workflow/agent-start', () => { lifecycle.push('start') })
      ctx.on('workflow/agent-end', (_info, agent) => { lifecycle.push(`end:${agent.outcome}`) })
      const handle = ctx.workflowEngine.start({
        ...scripted("try { await agent('p'); return 'unreachable' } catch (e) { return { code: e.code, message: e.message } }"),
        parent,
      })
      const worker = (handle as unknown as { worker: { postMessage(message: unknown): void } }).worker
      const post = vi.spyOn(worker, 'postMessage')
      const childMessageTypes = (): HostToWorkerType[] => post.mock.calls
        .map(([message]) => (message as { type: HostToWorkerType }).type)
        .filter(type => type === HostToWorkerType.ChildStarted || type === HostToWorkerType.ChildFailed)

      await waitFor(() => { expect(provider.runs.length).toBe(1) })
      provider.runs[0]!.rejectResult(new Error('backend failed before publication'))
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(childMessageTypes()).toEqual([])
      expect(lifecycle).toEqual([])

      provider.runs[0]!.publish()
      const result = await handle.result
      expect(result.value).toMatchObject({ code: 'AGENT_RESULT' })
      expect((result.value as { message: string }).message).toContain('backend failed before publication')
      expect(childMessageTypes()).toEqual([HostToWorkerType.ChildStarted, HostToWorkerType.ChildFailed])
      expect(lifecycle).toEqual(['start', 'end:failed'])
      post.mockRestore()
      await handle.dispose()
    })

    it('classifies provider start rejection as AGENT_START, drops an early result, and emits no false lifecycle pair', async () => {
      const { ctx, parent, provider } = await setup({ manual: true, deferStart: true })
      const lifecycle: string[] = []
      ctx.on('workflow/agent-start', () => { lifecycle.push('start') })
      ctx.on('workflow/agent-end', () => { lifecycle.push('end') })

      const handle = ctx.workflowEngine.start({
        ...scripted("try { await agent('p'); return 'unreachable' } catch (e) { return { code: e.code, message: e.message } }"),
        parent,
      })
      await waitFor(() => { expect(provider.runs.length).toBe(1) })
      // ACP-style failure can settle result(error) before its session/publication
      // boundary rejects. Start rejection must dominate that buffered child outcome.
      provider.runs[0]!.settle({ output: [], stopReason: 'error' })
      await new Promise(resolve => setTimeout(resolve, 0))
      provider.runs[0]!.rejectStart(new Error('publication rolled back'))

      const result = await handle.result
      expect(result.value).toMatchObject({ code: 'AGENT_START' })
      expect((result.value as { message: string }).message).toContain('publication rolled back')
      expect(lifecycle).toEqual([])
      await waitFor(() => {
        expect(provider.runs[0]!.disposed).toBe(true)
        expect(provider.runs[0]!.disposeCalls).toBe(1)
      })
      await handle.dispose()
      expect(provider.runs[0]!.disposeCalls).toBe(1)
    })

    it('aborts a pending provider start once without publishing workflow lifecycle', async () => {
      const { ctx, parent, provider } = await setup({ manual: true, deferStart: true, config: { disposeGraceMs: 500 } })
      const lifecycle: string[] = []
      ctx.on('workflow/agent-start', () => { lifecycle.push('start') })
      ctx.on('workflow/agent-end', () => { lifecycle.push('end') })

      const handle = ctx.workflowEngine.start({ ...scripted("return await agent('pending')"), parent })
      await waitFor(() => { expect(provider.runs.length).toBe(1) })
      const disposal = handle.dispose()
      await waitFor(() => {
        expect(provider.runs[0]!.cancelled).toBe('workflow disposed')
        expect(provider.runs[0]!.disposed).toBe(true)
      })
      // Ensure the host-driven disposal removed the registry entry before the
      // late start rejection; its callback must not invoke dispose again.
      await new Promise(resolve => setTimeout(resolve, 0))
      provider.runs[0]!.rejectStart(new Error('cancelled before publication'))

      const result = await handle.result
      await disposal
      expect(result.stopReason).toBe('cancelled')
      expect(lifecycle).toEqual([])
      expect(provider.runs[0]!.disposeCalls).toBe(1)
    })

    it('a child result REJECTION crosses back as a fatal AGENT_RESULT error (a broken provider is not a failed child)', async () => {
      const ctx = new Context()
      await ctx.plugin(SubagentRuntime)
      const provider: SubagentProvider = {
        name: 'rejecting',
        capabilities: { outputSchema: true, depthLimit: true, toolFilter: true, persona: false },
        inheritsParentContext: false,
        start: async () => ({
          id: SessionId('reject-child'),
          localAgent: undefined,
          result: Promise.reject(new Error('backend exploded')),
          dispose: () => Promise.resolve(),
        }),
      }
      ctx.subagents.registerProvider(provider)
      await ctx.plugin(WorkerThreadWorkflowEngine, { provider: 'rejecting', maxConcurrentAgents: 2 })
      const result = await run(ctx, fakeParent(), scripted(`
        try { await agent('p'); return 'unreachable' } catch (e) { return { name: e.name, code: e.code, fatal: e.fatal, message: e.message } }
      `))
      expect(result.value).toMatchObject({ name: 'WorkflowError', code: 'AGENT_RESULT', fatal: true })
      expect((result.value as { message: string }).message).toContain('backend exploded')
    })

    it('maps a non-JSON ready-child result to fatal AGENT_RESULT instead of wedging the bridge', async () => {
      const { ctx, parent } = await setup({
        reply: () => ({ output: [], structured: () => { /* deliberately outside lossless JSON */ }, stopReason: 'completed' }),
      })
      const result = await run(ctx, parent, scripted(`
        try { await agent('p'); return 'unreachable' } catch (e) { return { code: e.code, message: e.message } }
      `))
      expect(result.value).toMatchObject({ code: 'AGENT_RESULT' })
      expect((result.value as { message: string }).message).toContain('workflow child result could not cross the worker boundary')
    })

    it('contains a non-JSON result even if the injected subagent service violates its normalization contract', async () => {
      // The real worker boundary must reject a non-JSON same-process result.
      const { ctx, parent } = await setup()
      const invalid = {
        output: [],
        structured: () => { /* deliberately outside lossless JSON */ },
        stopReason: 'completed',
      } as unknown as SubagentResult
      const start = vi.spyOn(ctx.subagents, 'start').mockResolvedValue({
        id: SessionId('raw-invalid-child'),
        localAgent: undefined,
        result: Promise.resolve(invalid),
        dispose: () => Promise.resolve(),
      })

      const result = await run(ctx, parent, scripted(`
        try { await agent('p'); return 'unreachable' } catch (e) { return { code: e.code, message: e.message } }
      `))

      expect(start).toHaveBeenCalledOnce()
      expect(result.value).toMatchObject({ code: 'AGENT_RESULT' })
      expect((result.value as { message: string }).message)
        .toContain('workflow child result could not cross the worker boundary')
    })

    it('a child whose dispose() throws synchronously cannot wedge the script (the host acks anyway)', async () => {
      const ctx = new Context()
      await ctx.plugin(SubagentRuntime)
      const provider: SubagentProvider = {
        name: 'bad-dispose',
        capabilities: { outputSchema: true, depthLimit: true, toolFilter: true, persona: false },
        inheritsParentContext: false,
        start: async () => ({
          id: SessionId('bad-dispose-child'),
          localAgent: undefined,
          result: Promise.resolve({ output: [{ type: 'text', text: 'fine' }], stopReason: 'completed' }),
          cancel: () => { /* settled already */ },
          dispose: () => { throw new Error('dispose exploded') },
        }),
      }
      ctx.subagents.registerProvider(provider)
      await ctx.plugin(WorkerThreadWorkflowEngine, { provider: 'bad-dispose', maxConcurrentAgents: 2 })
      const result = await run(ctx, fakeParent(), scripted("return await agent('p')"))
      expect(result.stopReason).toBe('completed')
      expect(result.value).toBe('fine')
    })

    it('a child dispose() rejecting an UNRENDERABLE value still acks — the containment warn is total', async () => {
      const ctx = new Context()
      await ctx.plugin(SubagentRuntime)
      const provider: SubagentProvider = {
        name: 'coercion-trap-dispose',
        capabilities: { outputSchema: true, depthLimit: true, toolFilter: true, persona: false },
        inheritsParentContext: false,
        start: async () => ({
          id: SessionId('trap-child'),
          localAgent: undefined,
          result: Promise.resolve({ output: [{ type: 'text', text: 'fine' }], stopReason: 'completed' }),
          cancel: () => { /* settled already */ },
          // The rejection VALUE's own coercion throws: a warn built with bare
          // String(error) would itself throw, skipping the ChildDisposed ack
          // and wedging the script's finally until the grace/terminate path.
          // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- the non-Error rejection IS the scenario under test
          dispose: () => Promise.reject({ toString: () => { throw new Error('coercion trap') } }),
        }),
      }
      ctx.subagents.registerProvider(provider)
      await ctx.plugin(WorkerThreadWorkflowEngine, { provider: 'coercion-trap-dispose', maxConcurrentAgents: 2 })
      const result = await run(ctx, fakeParent(), scripted("return await agent('p')"))
      expect(result.stopReason).toBe('completed')
      expect(result.value).toBe('fine')
    })

    it('the worker spawns with a scrubbed environment: an escaped script finds no ambient credentials', async () => {
      const { ctx, parent } = await setup()
      // A canary in the HARNESS process's env: with an inherited environment
      // the escape below would read it back (exactly how DEEPSEEK_API_KEY
      // would leak); the worker env keeps every ambient variable out. Windows
      // additionally receives the host temp path (TMP/TEMP) so `os.tmpdir()`
      // inside the worker resolves instead of degrading to a cwd-relative
      // `undefined\temp` (tsx writes its transform cache there).
      process.env.WORKFLOW_ENV_CANARY = 'leak me'
      // The unbuilt worker forwards TSX_TSCONFIG_PATH (a path pin, not a
      // credential); clear it so this test observes the empty ambient case
      // regardless of the parent's environment.
      const tsconfigPath = process.env.TSX_TSCONFIG_PATH
      delete process.env.TSX_TSCONFIG_PATH
      try {
        const result = await run(ctx, parent, scripted(`
          const proc = ${ESCAPE}
          return { canary: proc.env.WORKFLOW_ENV_CANARY ?? null, keys: Object.keys(proc.env).sort() }
        `))
        expect(result.stopReason).toBe('completed')
        const expectedKeys = process.platform === 'win32' ? ['TEMP', 'TMP'] : []
        expect(result.value).toEqual({ canary: null, keys: expectedKeys })
      } finally {
        if (tsconfigPath === undefined) delete process.env.TSX_TSCONFIG_PATH
        else process.env.TSX_TSCONFIG_PATH = tsconfigPath
        delete process.env.WORKFLOW_ENV_CANARY
      }
    })

    it('workerSpawnEnv injects the host temp path on win32 and leaves the POSIX peer empty', () => {
      const tmp = tmpdir()
      expect(workerSpawnEnv('win32')).toEqual({ TMP: tmp, TEMP: tmp })
      expect(workerSpawnEnv('linux')).toEqual({})
    })

    it('workerSpawnEnv forwards TSX_TSCONFIG_PATH when the snapshot harness pins it', () => {
      const tsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))
      expect(workerSpawnEnv('linux', tsconfig)).toEqual({ TSX_TSCONFIG_PATH: tsconfig })
      expect(workerSpawnEnv('win32', tsconfig)).toEqual({
        TMP: tmpdir(),
        TEMP: tmpdir(),
        TSX_TSCONFIG_PATH: tsconfig,
      })
    })

    it('the unbuilt worker forwards exactly TSX_TSCONFIG_PATH through the scrub: the paths-map pin survives, secrets do not', async () => {
      const { ctx, parent } = await setup()
      // The ACP snapshot harness runs the parent with its cwd OUTSIDE the
      // repo and pins the repo tsconfig through this variable; the worker
      // must inherit the pin (or its dsh-* imports silently resolve to
      // unbuilt lib/ bundles) while every other variable stays scrubbed.
      const tsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))
      process.env.TSX_TSCONFIG_PATH = tsconfig
      process.env.WORKFLOW_ENV_CANARY = 'leak me'
      try {
        const result = await run(ctx, parent, scripted(`
          const proc = ${ESCAPE}
          return { keys: Object.keys(proc.env).sort(), tsconfig: proc.env.TSX_TSCONFIG_PATH }
        `))
        expect(result.stopReason).toBe('completed')
        const expectedKeys = process.platform === 'win32'
          ? ['TEMP', 'TMP', 'TSX_TSCONFIG_PATH']
          : ['TSX_TSCONFIG_PATH']
        expect(result.value).toEqual({ keys: expectedKeys, tsconfig })
      } finally {
        delete process.env.TSX_TSCONFIG_PATH
        delete process.env.WORKFLOW_ENV_CANARY
      }
    })
  })

  describe('lifecycle: parse errors, cancellation, termination, disposal', () => {
    it('start() throws synchronously for invalid meta data or an unparseable body (host-side pre-checks)', async () => {
      const { ctx, parent } = await setup()
      // Meta is DATA — shape violations reject loud, every one named.
      expect(() => ctx.workflowEngine.start({ script: 'return 1', meta: { name: '', description: 'd' }, parent })).toThrow(/meta\.name must be a non-empty string/)
      expect(() => ctx.workflowEngine.start({ script: 'return 1', meta: { name: 'x', description: 'd', extra: 1 } as unknown as WorkflowMeta, parent })).toThrow(/META_INVALID|not a recognized field/)
      expect(() => ctx.workflowEngine.start({ ...scripted('return ((('), parent })).toThrow(/does not parse/)
      // The likeliest authoring slip — a Claude Code-style meta header in the
      // body — gets a pointed message, not a bare SyntaxError.
      expect(() => ctx.workflowEngine.start({ ...scripted("export const meta = { name: 'x', description: 'd' }\nreturn 1"), parent })).toThrow(/meta rides the `meta` request field/)
    })

    it('cancel() aborts in-flight children (signal AND cancel RPC) and settles the run cancelled', async () => {
      const { ctx, parent, provider } = await setup({ manual: true })
      const ends: unknown[] = []
      ctx.on('workflow/agent-end', (_info, agent) => { ends.push(agent) })
      const runEnds: WorkflowResultInfo[] = []
      ctx.on('workflow/end', (_info, result) => { runEnds.push(result) })
      const handle = ctx.workflowEngine.start({ ...scripted("return await agent('long job')"), parent })
      await waitFor(() => { expect(provider.runs.length).toBe(1) })
      handle.cancel('user stopped it')
      const result = await handle.result
      expect(result.stopReason).toBe('cancelled')
      expect(result.error).toContain('user stopped it')
      await handle.dispose()
      expect(provider.runs[0]!.disposed).toBe(true)
      expect(ends).toEqual([expect.objectContaining({ seq: 1, outcome: 'cancelled' })])
      // workflow/end is an observer's only death signal: it fires for a
      // cancelled run too, mirroring the settled outcome data.
      expect(runEnds).toEqual([{ stopReason: 'cancelled', error: result.error, agentsStarted: result.agentsStarted }])
    })

    it('an already-aborted request signal cancels before the body ever runs (the go handshake holds it)', async () => {
      const { ctx, parent, provider } = await setup()
      const controller = new AbortController()
      controller.abort()
      const logs: string[] = []
      ctx.on('workflow/log', (_info, message) => { logs.push(message) })
      const handle = ctx.workflowEngine.start({ ...scripted("log('ran')\nreturn 123"), parent, signal: controller.signal })
      const result = await handle.result
      expect(result.stopReason).toBe('cancelled')
      expect(result.value).toBeNull()
      expect(logs).toEqual([])
      expect(provider.runs.length).toBe(0)
      await handle.dispose()
    })

    it('cancel() right after start() cancels before the body runs; the signal aborting mid-run cancels like cancel()', async () => {
      const { ctx, parent, provider } = await setup({ manual: true })
      const first = ctx.workflowEngine.start({ ...scripted("return await agent('never')"), parent })
      // No-reason cancel: the canonical default reason must ride the result.
      first.cancel()
      const firstResult = await first.result
      expect(firstResult.stopReason).toBe('cancelled')
      expect(firstResult.error).toContain('workflow cancelled')
      expect(provider.runs.length).toBe(0)
      await first.dispose()

      const controller = new AbortController()
      const second = ctx.workflowEngine.start({ ...scripted("return await agent('job')"), parent, signal: controller.signal })
      await waitFor(() => { expect(provider.runs.length).toBe(1) })
      controller.abort()
      expect((await second.result).stopReason).toBe('cancelled')
      await second.dispose()
    })

    it('removes the exact external abort callback on first settlement or teardown', async () => {
      const { ctx, parent } = await setup()
      const settledController = new AbortController()
      const settledAdd = vi.spyOn(settledController.signal, 'addEventListener')
      const settledRemove = vi.spyOn(settledController.signal, 'removeEventListener')
      const completed = ctx.workflowEngine.start({ ...scripted('return 123'), parent, signal: settledController.signal })
      const settledAbort = settledAdd.mock.calls.find(([type]) => type === 'abort')?.[1]
      expect(typeof settledAbort).toBe('function')

      await expect(completed.result).resolves.toMatchObject({ value: 123, stopReason: 'completed' })
      expect(settledRemove).toHaveBeenCalledWith('abort', settledAbort)
      const cancelAfterSettle = vi.spyOn(completed, 'cancel')
      settledController.abort()
      expect(cancelAfterSettle).not.toHaveBeenCalled()
      cancelAfterSettle.mockRestore()
      await completed.dispose()

      const manual = await setup({ manual: true })
      const teardownController = new AbortController()
      const teardownAdd = vi.spyOn(teardownController.signal, 'addEventListener')
      const teardownRemove = vi.spyOn(teardownController.signal, 'removeEventListener')
      const tornDown = manual.ctx.workflowEngine.start({
        ...scripted("return await agent('job')"),
        parent: manual.parent,
        signal: teardownController.signal,
      })
      await waitFor(() => { expect(manual.provider.runs).toHaveLength(1) })
      const teardownAbort = teardownAdd.mock.calls.find(([type]) => type === 'abort')?.[1]
      expect(typeof teardownAbort).toBe('function')

      const disposing = tornDown.dispose()
      expect(teardownRemove).toHaveBeenCalledWith('abort', teardownAbort)
      await disposing
    })

    it('a child-start racing the host cancel is refused: no child starts after cancellation', async () => {
      const { ctx, parent, provider } = await setup({ manual: true })
      // Cancel from INSIDE the log listener: the worker has already posted
      // its child-start (queued right behind the log message), so the host
      // processes it with cancelReason set — the refusal arm no real-world
      // timing can hit reliably. (The closure runs only after `handle` below
      // is initialized — the listener fires on the worker's first message.)
      ctx.on('workflow/log', () => { handle.cancel('cancelled from the log listener') })
      const handle = ctx.workflowEngine.start({ ...scripted("log('mark')\nreturn await agent('late')"), parent })
      const result = await handle.result
      expect(result.stopReason).toBe('cancelled')
      expect(provider.runs.length).toBe(0)
      await handle.dispose()
    })

    it('post-cancel narration is suppressed host-side, and completion racing a cancel reports cancelled', async () => {
      const { ctx, parent } = await setup()
      const narration: string[] = []
      ctx.on('workflow/log', (_info, message) => { narration.push(message) })
      ctx.on('workflow/phase', (_info, title) => { narration.push(`phase:${title}`) })
      const handle = ctx.workflowEngine.start({
        // The sync spin keeps the worker's loop busy so the cancel message
        // cannot be processed before the script settles `completed` — the
        // worker posts a completed result that must LOSE to the in-flight
        // host cancellation. The trailing narration exercises host-side
        // suppression: posted pre-cancel-processing worker-side, arriving
        // post-cancel host-side.
        ...scripted(`
          log('started')
          const end = Date.now() + 1000
          while (Date.now() < end) {}
          phase('late phase')
          log('late log')
          return 'done'
        `),
        parent,
      })
      await waitFor(() => { expect(narration).toContain('started') })
      handle.cancel('raced the completion')
      const result = await handle.result
      expect(result.stopReason).toBe('cancelled')
      expect(result.error).toContain('raced the completion')
      expect(narration).toEqual(['started'])
      await handle.dispose()
    }, 15_000)

    it('cancel() force-settles a script parked on a promise no hook owns, and TERMINATES its worker', async () => {
      const { ctx, parent } = await setup({ config: { provider: 'stub', disposeGraceMs: 50 } })
      const runEnds: WorkflowResultInfo[] = []
      ctx.on('workflow/end', (_info, result) => { runEnds.push(result) })
      const handle = ctx.workflowEngine.start({
        ...scripted("await new Promise(() => {})\nreturn 'unreachable'"),
        parent,
      })
      handle.cancel('user aborted')
      const result = await handle.result
      expect(result.stopReason).toBe('cancelled')
      expect(result.error).toContain('user aborted')
      // The grace force-settle fires workflow/end exactly like an ordinary
      // settlement — a terminated script's death still reaches observers.
      expect(runEnds).toEqual([{ stopReason: 'cancelled', error: result.error, agentsStarted: 0 }])
      await handle.dispose()
    })

    it('dispose() on a stuck script returns within the grace instead of hanging (result settles cancelled)', async () => {
      const { ctx, parent } = await setup({ config: { provider: 'stub', disposeGraceMs: 50 } })
      const handle = ctx.workflowEngine.start({
        ...scripted("await new Promise(() => {})\nreturn 'unreachable'"),
        parent,
      })
      const before = Date.now()
      await handle.dispose()
      expect(Date.now() - before).toBeLessThan(2000)
      const result = await handle.result
      expect(result.stopReason).toBe('cancelled')
    })

    it('dispose() is idempotent and settles cleanly after a completed run', async () => {
      const { ctx, parent } = await setup()
      const handle = ctx.workflowEngine.start({ ...scripted('return 1'), parent })
      await handle.result
      await handle.dispose()
      await handle.dispose()
    })

    it('a settled run arms NO grace timer: disposing a completed run must not pin it for disposeGraceMs', async () => {
      // A distinctive grace so the spy can tell the cancel-path grace timer
      // apart from every other timeout in flight.
      const GRACE = 44_444
      const { ctx, parent } = await setup({ config: { provider: 'stub', disposeGraceMs: GRACE } })
      const handle = ctx.workflowEngine.start({ ...scripted('return 1'), parent })
      await handle.result
      const spy = vi.spyOn(globalThis, 'setTimeout')
      try {
        await handle.dispose()
        // dispose()'s own bounded-wait sleep is the ONLY grace-sized timer
        // allowed here; before the settled guard, cancel() armed a second one
        // that nothing would ever clear (the run was already settled), keeping
        // the WorkerRun/Worker closure alive until the grace expired.
        const graceTimers = spy.mock.calls.filter(call => call[1] === GRACE)
        expect(graceTimers.length).toBe(1)
      } finally {
        spy.mockRestore()
      }
    })

    it('strays: children fired without await are aborted once the script settles, and dispose() waits for their disposal', async () => {
      const { ctx, parent, provider } = await setup({ manual: true, disposeDelayMs: 40 })
      const handle = ctx.workflowEngine.start({
        ...scripted(`
          agent('stray')
          return 'done without awaiting'
        `),
        parent,
      })
      const result = await handle.result
      expect(result.stopReason).toBe('completed')
      await waitFor(() => { expect(provider.runs.length).toBe(1) })
      await handle.dispose()
      // Not a waitFor: by the time dispose() returns, the slow child disposal
      // must already be complete (host-side registry quiescence).
      expect(provider.runs[0]!.disposed).toBe(true)
    })

    it('result settlement reaps a registered stray even when the worker cannot relay disposal', async () => {
      const { ctx, parent, provider } = await setup({
        manual: true,
        config: { provider: 'stub', disposeGraceMs: 30_000 },
      })
      const handle = ctx.workflowEngine.start({
        ...scripted("agent('stray')\nawait new Promise(() => {})"),
        parent,
      })
      await waitFor(() => { expect(provider.runs).toHaveLength(1) })

      // Claim the host result while the real worker remains wedged, so it can
      // send neither ChildDispose nor an exit. This leaves the accepted child
      // in the host registry when public disposal begins.
      const worker = (handle as unknown as { worker: Worker }).worker
      worker.emit('message', {
        type: WorkerToHostType.Result,
        result: { value: 'synthetic completion', stopReason: 'completed', agentsStarted: 1 },
      })
      await expect(handle.result).resolves.toMatchObject({ stopReason: 'completed' })
      await waitFor(() => { expect(provider.runs[0]!.disposed).toBe(true) }, 1000)

      const disposal = handle.dispose()
      await disposal
      expect(provider.runs[0]!.disposeCalls).toBe(1)
      await ctx.fiber.dispose()
    })

    it('the settle-reap fires the request signal too: a provider honoring ONLY the signal winds its stray down promptly', async () => {
      const ctx = new Context()
      await ctx.plugin(SubagentRuntime)
      const aborted: string[] = []
      const provider: SubagentProvider = {
        name: 'signal-only',
        capabilities: { outputSchema: true, depthLimit: true, toolFilter: true, persona: false },
        inheritsParentContext: false,
        start: async (request) => {
          let settle!: (result: SubagentResult) => void
          const result = new Promise<SubagentResult>((resolve) => { settle = resolve })
          request.signal.addEventListener('abort', () => {
            aborted.push(String(request.signal.reason))
            settle({ output: [], stopReason: 'aborted' })
          }, { once: true })
          return {
            id: SessionId('signal-only-child'),
            localAgent: undefined,
            result,
            dispose: () => Promise.resolve(),
          }
        },
      }
      ctx.subagents.registerProvider(provider)
      await ctx.plugin(WorkerThreadWorkflowEngine, { provider: 'signal-only', maxConcurrentAgents: 2 })
      const handle = ctx.workflowEngine.start({
        ...scripted(`
          agent('stray, never awaited')
          return 'done'
        `),
        parent: fakeParent(),
      })
      const result = await handle.result
      expect(result.stopReason).toBe('completed')
      // BEFORE dispose(): the settlement itself must have aborted the signal —
      // without it this child would stay live until dispose's terminate. This
      // is a HOST-PROMPTNESS claim, not a cold-start race — a tight explicit
      // bound (unlike the file default) so a multi-second reap regression
      // cannot pass by outlasting the wait.
      await waitFor(() => { expect(aborted).toEqual(['workflow settled']) }, 1000)
      await handle.dispose()
    })

    it('the settle-reap aborts a pending provider start before workflow/end', async () => {
      const { ctx, parent, provider } = await setup({ manual: true, deferStart: true })
      const childLifecycle: string[] = []
      let cancellationAtWorkflowEnd: string | undefined
      ctx.on('workflow/agent-start', () => { childLifecycle.push('start') })
      ctx.on('workflow/agent-end', () => { childLifecycle.push('end') })
      ctx.on('workflow/end', () => {
        cancellationAtWorkflowEnd = provider.runs[0]?.cancelled
      })
      const handle = ctx.workflowEngine.start({
        ...scripted(`
          agent('start-pending stray')
          return 'done'
        `),
        parent,
      })

      const result = await handle.result

      expect(result.stopReason).toBe('completed')
      expect(provider.runs).toHaveLength(1)
      expect(provider.runs[0]!.request.signal?.aborted).toBe(true)
      expect(provider.runs[0]!.request.signal?.reason).toBe('workflow settled')
      expect(provider.runs[0]!.cancelled).toBe('workflow settled')
      expect(cancellationAtWorkflowEnd).toBe('workflow settled')
      expect(childLifecycle).toEqual([])
      await handle.dispose()
      expect(provider.runs[0]!.disposeCalls).toBe(1)
    })

    it('a duplicate Result after the terminal claim cannot repeat cleanup or rewrite the outcome', async () => {
      let signalAborts = 0
      const { ctx, parent, provider } = await setup({
        manual: true,
        onChildAbortString: (_reason, index) => { if (index === 0) signalAborts += 1 },
      })
      const handle = ctx.workflowEngine.start({
        ...scripted("agent('stray')\nawait new Promise(() => {})"),
        parent,
      })
      await waitFor(() => { expect(provider.runs).toHaveLength(1) })
      const worker = (handle as unknown as { worker: Worker }).worker

      worker.emit('message', {
        type: WorkerToHostType.Result,
        result: { value: 'first', stopReason: 'completed', agentsStarted: 1 },
      })
      worker.emit('message', {
        type: WorkerToHostType.Result,
        result: { value: 'late', stopReason: 'completed', agentsStarted: 1 },
      })

      await expect(handle.result).resolves.toMatchObject({ value: 'first', stopReason: 'completed' })
      expect(signalAborts).toBe(1)
      await handle.dispose()
      expect(signalAborts).toBe(1)
      await ctx.fiber.dispose()
    })

    it('a grace-terminated worker reaps its child on exit without waiting for consumer dispose()', async () => {
      const { ctx, parent, provider } = await setup({
        manual: true,
        config: { provider: 'stub', maxConcurrentAgents: 2, disposeGraceMs: 100 },
      })
      const handle = ctx.workflowEngine.start({
        // Let child-start cross, then make the worker unable to process its
        // Cancel message. Grace settles the result and terminates the thread;
        // that exit must independently own the host registry's disposal pass.
        ...scripted(`
          agent('survives until exit reap')
          for (let i = 0; i < 20; i++) await null
          const end = Date.now() + 1500
          while (Date.now() < end) {}
          return 'unreachable'
        `),
        parent,
      })
      await waitFor(() => { expect(provider.runs).toHaveLength(1) })

      handle.cancel('force termination')
      const result = await handle.result

      expect(result.stopReason).toBe('cancelled')
      // Deliberately assert before handle.dispose(): host-owned worker exit,
      // not consumer courtesy, is responsible for this resource guarantee.
      await waitFor(() => { expect(provider.runs[0]!.disposed).toBe(true) }, 1000)
      expect(provider.runs[0]!.disposeCalls).toBe(1)
      await handle.dispose()
      await ctx.fiber.dispose()
    }, 15_000)

    it('dispose() on a wedged worker host-drives child disposal inside the grace: it returns with the children DISPOSED, not with their teardown still in flight', async () => {
      const { ctx, parent, provider } = await setup({
        manual: true,
        disposeDelayMs: 40,
        config: { provider: 'stub', maxConcurrentAgents: 8, disposeGraceMs: 400 },
      })
      const handle = ctx.workflowEngine.start({
        // Same shape as the wedged-cancel test above: the child's start RPC
        // reaches the host, then the script seizes its worker's loop, so the
        // worker can relay NO dispose RPC — the host's own dispose() drive is
        // the only thing that can start (and finish) this child's disposal
        // before the grace runs out.
        ...scripted(`
          agent('wedged child')
          for (let i = 0; i < 20; i++) await null
          const end = Date.now() + 1500
          while (Date.now() < end) {}
          return 'raced'
        `),
        parent,
      })
      await waitFor(() => { expect(provider.runs.length).toBe(1) })
      const before = Date.now()
      await handle.dispose()
      // Bounded by the grace (plus the terminate), never by the 1.5s spin.
      expect(Date.now() - before).toBeLessThan(1200)
      // Not a waitFor: dispose() resolving IS the quiescence claim — the slow
      // child disposal must be complete, not merely started (before the
      // host-driven drive, disposal only STARTED at the post-terminate reap,
      // so dispose() returned with it still in flight).
      expect(provider.runs[0]!.disposed).toBe(true)
      const result = await handle.result
      expect(result.stopReason).toBe('cancelled')
    }, 15_000)

    it('a live child disposed by the dispose() drive is disposed ONCE, and the worker\'s late dispose RPC still gets its ack (the script settles, not the grace)', async () => {
      const { ctx, parent, provider } = await setup({ manual: true })
      const handle = ctx.workflowEngine.start({
        ...scripted(`
          await agent('long child')
          return 'unreachable'
        `),
        parent,
      })
      await waitFor(() => { expect(provider.runs.length).toBe(1) })
      const handleDispose = handle.dispose()
      const result = await handle.result
      // The script itself settled (the wrapper's own dispose RPC found the
      // child already reaped host-side and was acked) — a missing ack would
      // wedge the wrapper's finally until the 5s default grace force-settle.
      expect(result.stopReason).toBe('cancelled')
      expect(result.error).toContain('workflow disposed')
      await handleDispose
      expect(provider.runs[0]!.disposed).toBe(true)
      // The memo: the host drive and the worker's RPC share one disposal.
      expect(provider.runs[0]!.disposeCalls).toBe(1)
    })

    it('the grace force-settle pairs every stranded start: a host-synthesized cancelled agent-end lands before workflow/end', async () => {
      const { ctx, parent, provider } = await setup({ manual: true, config: { provider: 'stub', maxConcurrentAgents: 8, disposeGraceMs: 300 } })
      const ends: { seq: number; outcome: string }[] = []
      const order: string[] = []
      ctx.on('workflow/agent-start', (_info, agent) => { order.push(`start:${agent.seq}`) })
      ctx.on('workflow/agent-end', (_info, agent) => {
        ends.push({ seq: agent.seq, outcome: agent.outcome })
        order.push(`end:${agent.seq}`)
      })
      ctx.on('workflow/end', () => { order.push('run-end') })
      const handle = ctx.workflowEngine.start({
        // 'slow' starts and its agent-start crosses to observers (the awaited
        // 'fast' call keeps the worker loop turning), then the script seizes
        // the loop: the wedged worker can never author slow's agent-end —
        // only the host's ledger can close the pair.
        ...scripted(`
          const p = agent('slow')
          await agent('fast')
          const end = Date.now() + 1500
          while (Date.now() < end) {}
          return 'raced'
        `),
        parent,
      })
      await waitFor(() => { expect(order.filter(entry => entry.startsWith('start:')).length).toBe(2) })
      const fast = provider.runs.find(run => (run.request.prompt[0] as { text?: string }).text === 'fast')!
      fast.settle(text('fast done'))
      handle.cancel('stop now')
      const result = await handle.result
      expect(result.stopReason).toBe('cancelled')
      // fast's end is the worker's own report; slow's is host-synthesized at
      // the force-settle — exactly one end per started seq, no third event.
      expect(ends).toEqual([
        { seq: 2, outcome: 'completed' },
        { seq: 1, outcome: 'cancelled' },
      ])
      // Both ends reached observers BEFORE workflow/end: a progress consumer
      // can finalize its state at run-end without dangling agents.
      expect(order.indexOf('run-end')).toBe(order.length - 1)
      await handle.dispose()
    }, 15_000)

    it('graceful cancellation keeps pairing worker-authored: exactly one agent-end per start, nothing synthesized on top', async () => {
      const { ctx, parent, provider } = await setup({ manual: true })
      const ends: { seq: number; outcome: string }[] = []
      const order: string[] = []
      ctx.on('workflow/agent-end', (_info, agent) => {
        ends.push({ seq: agent.seq, outcome: agent.outcome })
        order.push(`end:${agent.seq}`)
      })
      ctx.on('workflow/end', () => { order.push('run-end') })
      const handle = ctx.workflowEngine.start({
        ...scripted("await parallel([() => agent('a'), () => agent('b')])\nreturn 'unreachable'"),
        parent,
      })
      await waitFor(() => { expect(provider.runs.length).toBe(2) })
      handle.cancel('user stop')
      const result = await handle.result
      expect(result.stopReason).toBe('cancelled')
      // The live worker reported both pairs itself; the ledger must not add
      // a synthesized duplicate on any path that settles inside the grace.
      expect(ends.map(end => end.outcome)).toEqual(['cancelled', 'cancelled'])
      expect(new Set(ends.map(end => end.seq)).size).toBe(2)
      expect(order.indexOf('run-end')).toBe(order.length - 1)
      await handle.dispose()
    })
  })

  describe('worker death', () => {
    it('the first death signal closes admission to messages Node delivers before exit', async () => {
      const { ctx, parent, provider } = await setup({ manual: true })
      const phases: string[] = []
      ctx.on('workflow/phase', (_info, title) => { phases.push(title) })
      const handle = ctx.workflowEngine.start({
        ...scripted('await new Promise(() => {})'),
        parent,
      })
      const worker = (handle as unknown as { worker: Worker }).worker

      // Node may physically emit error -> queued message -> exit. Reproduce
      // that ordering deterministically at the Worker event boundary: the
      // late protocol data must not create work, narrate, or rewrite error.
      worker.emit('error', new Error('synthetic error-before-message'))
      worker.emit('message', { type: WorkerToHostType.Phase, title: 'late phase' })
      worker.emit('message', {
        type: WorkerToHostType.ChildStart,
        callId: 999,
        request: { prompt: 'late child' },
      })
      worker.emit('message', {
        type: WorkerToHostType.Result,
        result: { value: 'late', stopReason: 'completed', agentsStarted: 1 },
      })

      const result = await handle.result
      expect(result.stopReason).toBe('error')
      expect(result.error).toContain('synthetic error-before-message')
      expect(provider.runs).toHaveLength(0)
      expect(phases).toEqual([])
      await handle.dispose()
      await ctx.fiber.dispose()
    })

    it('refuses and disposes a provider run that becomes ready after its real worker dies', async () => {
      const ctx = new Context()
      await ctx.plugin(SubagentRuntime)
      const requested = Promise.withResolvers<SubagentStartRequest>()
      const ready = Promise.withResolvers<SubagentRun>()
      let disposeCalls = 0
      const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => ctx.logger)
      const provider: SubagentProvider = {
        name: 'late-ready',
        capabilities: { outputSchema: true, depthLimit: true, toolFilter: true, persona: false },
        inheritsParentContext: false,
        start: (request) => {
          requested.resolve(request)
          // Model a backend whose independent startup boundary cannot be
          // interrupted promptly. The host must still reject ownership if the
          // worker dies before this promise transfers the ready run.
          return ready.promise
        },
      }
      ctx.subagents.registerProvider(provider)
      await ctx.plugin(WorkerThreadWorkflowEngine, { provider: 'late-ready', maxConcurrentAgents: 1 })
      const lifecycle: string[] = []
      ctx.on('workflow/agent-start', () => { lifecycle.push('start') })
      ctx.on('workflow/agent-end', () => { lifecycle.push('end') })

      const handle = ctx.workflowEngine.start({
        ...scripted("return await agent('pending startup')"),
        parent: fakeParent(),
      })
      const request = await requested.promise
      const worker = (handle as unknown as { worker: Worker }).worker

      // Kill the actual Worker while provider startup is independently
      // pending. Death closes admission and aborts the shared signal, but this
      // deliberately uncooperative provider still fulfills afterward.
      await worker.terminate()
      const result = await handle.result
      expect(result.stopReason).toBe('error')
      expect(result.error).toContain('exit code')
      expect(request.signal.aborted).toBe(true)
      expect(request.signal.reason).toBe('workflow worker gone')

      ready.resolve({
        id: SessionId('late-ready-child'),
        localAgent: undefined,
        result: Promise.resolve({ output: [], stopReason: 'aborted' }),
        dispose: () => {
          disposeCalls += 1
          return Promise.reject(new Error('late ready dispose failed'))
        },
      })
      await waitFor(() => {
        expect(disposeCalls).toBe(1)
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('refused child dispose failed: Error: late ready dispose failed'))
      }, 1000)
      expect(lifecycle).toEqual([])

      await handle.dispose()
      expect(disposeCalls).toBe(1)
      await ctx.fiber.dispose()
    })

    it('a worker that exits before settling reports an error result and reaps its children', async () => {
      const ctx = new Context()
      await ctx.plugin(SubagentRuntime)
      // The child's dispose() REJECTS on top of the worker death: the reap
      // must contain it (warn, not crash) while still emptying the registry.
      const signalAborts: unknown[] = []
      const provider: SubagentProvider = {
        name: 'doomed',
        capabilities: { outputSchema: true, depthLimit: true, toolFilter: true, persona: false },
        inheritsParentContext: false,
        start: async (request) => {
          request.signal.addEventListener('abort', () => {
            signalAborts.push(request.signal.reason)
            // The death claim precedes the shared-signal fanout. This
            // synchronous callback cannot turn death into cancellation.
            handle.cancel('reentered from worker-death signal cleanup')
          }, { once: true })
          return {
            id: SessionId('doomed-child'),
            localAgent: undefined,
            result: new Promise(() => { /* never settles; the reap is the teardown */ }),
            dispose: () => Promise.reject(new Error('dispose exploded during reap')),
          }
        },
      }
      ctx.subagents.registerProvider(provider)
      await ctx.plugin(WorkerThreadWorkflowEngine, { provider: 'doomed', maxConcurrentAgents: 2 })
      const runEnds: WorkflowResultInfo[] = []
      ctx.on('workflow/end', (_info, result) => { runEnds.push(result) })
      const childStarted = Promise.withResolvers<undefined>()
      ctx.on('workflow/agent-start', () => { childStarted.resolve(undefined) })
      const handle = ctx.workflowEngine.start({
        ...scripted("return await agent('doomed')"),
        parent: fakeParent(),
      })
      const worker = (handle as unknown as { worker: Worker }).worker
      await childStarted.promise
      await worker.terminate()
      const result = await handle.result
      expect(result.stopReason).toBe('error')
      expect(result.error).toContain('exit code 1')
      expect(result.agentsStarted).toBe(1)
      // A worker death is a stop reason like any other: workflow/end fires
      // with the error outcome — for a bus observer it is the only obituary.
      expect(runEnds).toEqual([{ stopReason: 'error', error: result.error, agentsStarted: 1 }])
      // Result already settled — this is the reap's promptness, not a
      // cold-start race; tight explicit bound (see the helper's doc comment).
      await waitFor(() => {
        expect(signalAborts).toEqual(['workflow worker gone'])
      }, 1000)
      await Promise.resolve()
      expect(result.stopReason).toBe('error')
      await handle.dispose()
    }, 15_000)

    it('an uncaught exception inside the worker surfaces as an error result and reaps the in-flight child', async () => {
      const { ctx, parent, provider } = await setup({ manual: true })
      const handle = ctx.workflowEngine.start({
        ...scripted(`
          agent('in flight when the worker dies')
          const proc = ${ESCAPE}
          const st = globalThis.constructor.constructor('return setTimeout')()
          await new Promise(resolve => st(resolve, 200))
          proc.nextTick(() => { throw new Error('worker blew up') })
          await new Promise(() => {})
        `),
        parent,
      })
      const result = await handle.result
      expect(result.stopReason).toBe('error')
      expect(result.error).toContain('worker blew up')
      // The reap wound the stray child down (cancel + a CLEAN dispose).
      // Result already settled — this is the reap's promptness, not a
      // cold-start race; tight explicit bound (see the helper's doc comment).
      await waitFor(() => {
        expect(provider.runs.length).toBe(1)
        expect(provider.runs[0]!.disposed).toBe(true)
      }, 1000)
      await handle.dispose()
    }, 15_000)

    it('a worker death pairs every stranded start: the synthesized cancelled agent-end precedes the error workflow/end', async () => {
      const { ctx, parent, provider } = await setup({ manual: true })
      const ends: { seq: number; outcome: string }[] = []
      const order: string[] = []
      ctx.on('workflow/agent-start', (_info, agent) => { order.push(`start:${agent.seq}`) })
      ctx.on('workflow/agent-end', (_info, agent) => {
        ends.push({ seq: agent.seq, outcome: agent.outcome })
        order.push(`end:${agent.seq}`)
      })
      ctx.on('workflow/end', () => { order.push('run-end') })
      const handle = ctx.workflowEngine.start({
        ...scripted(`
          const p = agent('slow')
          await agent('fast')
          await new Promise(() => {})
        `),
        parent,
      })
      const worker = (handle as unknown as { worker: Worker }).worker
      await waitFor(() => { expect(order.filter(entry => entry.startsWith('start:')).length).toBe(2) })
      const fast = provider.runs.find(run => (run.request.prompt[0] as { text?: string }).text === 'fast')!
      fast.settle(text('fast done'))
      await waitFor(() => { expect(ends).toContainEqual({ seq: 2, outcome: 'completed' }) })
      await worker.terminate()
      const result = await handle.result
      expect(result.stopReason).toBe('error')
      expect(result.error).toContain('exit code 1')
      expect(ends).toEqual([
        { seq: 2, outcome: 'completed' },
        { seq: 1, outcome: 'cancelled' },
      ])
      expect(order.indexOf('run-end')).toBe(order.length - 1)
      await handle.dispose()
    }, 15_000)

    it('a dispose ack racing the worker death is dropped, not crashed (post after exit)', async () => {
      // Slow child disposal: the ack resolves only AFTER the worker died, so
      // it has nowhere to go and must be dropped silently (the workerGone
      // guard in post()).
      const { ctx, parent, provider } = await setup({ disposeDelayMs: 300 })
      const handle = ctx.workflowEngine.start({
        ...scripted(`
          agent('stray, never awaited')
          await new Promise(() => {})
        `),
        parent,
      })
      const worker = (handle as unknown as { worker: Worker }).worker
      await waitFor(() => {
        expect(provider.runs).toHaveLength(1)
        expect(provider.runs[0]!.disposeCalls).toBe(1)
        expect(provider.runs[0]!.disposed).toBe(false)
      })
      await worker.terminate()
      const result = await handle.result
      expect(result.stopReason).toBe('error')
      expect(result.error).toContain('exit code 1')
      // Result already settled — this is the reap's promptness (bounded
      // above the mock's fixed 300ms dispose delay, not a cold-start race);
      // tight explicit bound (see the helper's doc comment).
      await waitFor(() => { expect(provider.runs[0]!.disposed).toBe(true) }, 1000)
      await handle.dispose()
    }, 15_000)

    it('a worker death AFTER a cancel reports cancelled, not error', async () => {
      const { ctx, parent } = await setup({ config: { provider: 'stub', disposeGraceMs: 60_000 } })
      const handle = ctx.workflowEngine.start({
        ...scripted(`
          log('armed')
          await new Promise(() => {})
        `),
        parent,
      })
      const worker = (handle as unknown as { worker: Worker }).worker
      const logs: string[] = []
      ctx.on('workflow/log', (_info, message) => { logs.push(message) })
      await waitFor(() => { expect(logs).toContain('armed') })
      handle.cancel('stop it')
      // The grace is deliberately huge: only the host-triggered worker death,
      // not the cancellation timer, settles this.
      await worker.terminate()
      const result = await handle.result
      expect(result.stopReason).toBe('cancelled')
      expect(result.error).toContain('stop it')
      await handle.dispose()
    }, 15_000)
  })

  describe('service API', () => {
    it('run ids are unique and lifecycle meta is the run\'s borrowed immutable value', async () => {
      const { ctx, parent } = await setup()
      let eventMeta: WorkflowRunInfo | undefined
      ctx.on('workflow/start', (info) => { eventMeta = info })
      const first = ctx.workflowEngine.start({ ...scripted('return 1'), parent })
      const second = ctx.workflowEngine.start({ ...scripted('return 2'), parent })
      expect(first.id).not.toBe(second.id)
      expect(eventMeta!.meta).toBe(second.meta)
      expect(second.meta.name).toBe('test-flow')
      await Promise.all([first.result, second.result])
      await first.dispose()
      await second.dispose()
    })

    it('unregisters ctx.workflowEngine when the engine fiber is disposed (HMR safety)', async () => {
      const ctx = new Context()
      await ctx.plugin(SubagentRuntime)
      const fiber = await ctx.plugin(WorkerThreadWorkflowEngine, {})
      expect(ctx.get('workflowEngine')).toBeDefined()
      await fiber.dispose()
      expect(ctx.get('workflowEngine')).toBeUndefined()
    })

    it('keeps a holder-owned run usable when the engine unloads before its child starts', async () => {
      const { ctx, parent, provider, engineFiber } = await setup({ reply: () => text('survived reload') })
      let handle!: ReturnType<typeof ctx.workflowEngine.start>
      const holder = await ctx.plugin(Object.assign((inner: Context) => {
        handle = inner.workflowEngine.start({ ...scripted("return await agent('after reload')"), parent })
      }, { inject: ['workflowEngine'] }))

      try {
        // A real worker cannot deliver child-start in the synchronous start()
        // slice. Unload the provider before that message arrives: the returned
        // run belongs to `holder`, not to the engine fiber being reloaded.
        expect(provider.runs).toHaveLength(0)
        await engineFiber.dispose()
        expect(ctx.get('workflowEngine')).toBeUndefined()

        await expect(handle.result).resolves.toEqual({
          value: 'survived reload',
          stopReason: 'completed',
          agentsStarted: 1,
        })
        expect(provider.runs).toHaveLength(1)
      } finally {
        await handle.dispose()
        await holder.dispose()
        await ctx.fiber.dispose()
      }
    })

    it('has the class-plugin export shape (default = the engine service class)', () => {
      expect(workerEngineModule.default).toBe(WorkerThreadWorkflowEngine)
      expect('WorkerThreadWorkflowEngine' in workerEngineModule).toBe(false)
      const loader = Object.create(Loader.prototype) as Loader
      const unwrapped: unknown = loader.unwrapExports(workerEngineModule)
      expect(unwrapped).toBe(WorkerThreadWorkflowEngine)
    })
  })
})
