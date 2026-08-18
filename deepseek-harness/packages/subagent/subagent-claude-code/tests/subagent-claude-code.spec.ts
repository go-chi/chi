import { PassThrough } from 'node:stream'
import type {
  Options,
  Query,
  SDKMessage,
  SDKResultMessage,
  SpawnOptions,
} from '@anthropic-ai/claude-agent-sdk'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type {
  SubprocessHandle,
  SubprocessOutcome,
  SubprocessSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import * as claudeCode from '../src/index.ts'
import * as invariant from '../src/invariant.ts'
import {
  claudeSpawnSpec,
  ManagedClaudeCodeProcess,
  sdkEnvironmentOverlay,
} from '../src/process.ts'
import {
  claudeQueryOptions,
  consumeClaudeQuery,
  disposeClaudeCodeChild,
  startClaudeCodeRun,
  successfulResult,
  textTask,
  type ClaudeCodeRunSpec,
} from '../src/run.ts'

type QueryFactory = (params: {
  prompt: string
  options: Options
}) => Query

const queryMock = vi.hoisted(() => vi.fn<QueryFactory>())

vi.mock('@anthropic-ai/claude-agent-sdk', async importOriginal => ({
  ...await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>(),
  query: queryMock,
}))

const fakeParent = {
  id: 'parent',
  session: { header: { cwd: process.cwd() } },
} as unknown as Agent

function request(
  prompt: ContentBlock[] = [{ type: 'text', text: 'do the task' }],
  signal = new AbortController().signal,
) {
  return { prompt, parent: fakeParent, signal }
}

async function nextTask(): Promise<void> {
  await new Promise<void>((resolve) => { setImmediate(resolve) })
}

interface FakeChildOptions {
  readonly pid?: number
  readonly exitOnTerminate?: boolean
  readonly waitForExitError?: Error
  readonly doneError?: Error
}

interface FakeChild {
  readonly handle: SubprocessHandle
  readonly stdin: PassThrough
  readonly stdout: PassThrough
  readonly settle: (outcome?: SubprocessOutcome) => void
  readonly fail: (error: Error) => void
  readonly terminate: Mock<SubprocessHandle['terminate']>
  readonly waitForExit: Mock<SubprocessHandle['waitForExit']>
}

function fakeChild(options: FakeChildOptions = {}): FakeChild {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  let exited = false
  let resolveDone!: (outcome: SubprocessOutcome) => void
  let rejectDone!: (error: Error) => void
  const done = new Promise<SubprocessOutcome>((resolve, reject) => {
    resolveDone = resolve
    rejectDone = reject
  })
  // Individual tests deliberately exercise rejected and still-pending handles.
  void done.catch(() => {})
  const settle = (
    outcome: SubprocessOutcome = { exitCode: 0, signal: null },
  ): void => {
    if (exited) return
    exited = true
    resolveDone(outcome)
  }
  const fail = (error: Error): void => {
    if (exited) return
    exited = true
    rejectDone(error)
  }
  if (options.doneError !== undefined) fail(options.doneError)
  const terminate = vi.fn<SubprocessHandle['terminate']>(() => {
    if (options.exitOnTerminate !== false) settle()
  })
  const waitForExit = vi.fn<SubprocessHandle['waitForExit']>(async (signal?: AbortSignal): Promise<boolean> => {
    if (options.waitForExitError !== undefined) {
      throw options.waitForExitError
    }
    if (exited) return true
    if (signal === undefined) {
      await done.catch(() => {})
      return true
    }
    return await new Promise<boolean>((resolve) => {
      const onAbort = (): void => { resolve(false) }
      signal.addEventListener('abort', onAbort, { once: true })
      void done.then(
        () => {
          signal.removeEventListener('abort', onAbort)
          resolve(true)
        },
        () => {
          signal.removeEventListener('abort', onAbort)
          resolve(true)
        },
      )
    })
  })
  const handle: SubprocessHandle = {
    pid: options.pid ?? 1234,
    stdin,
    stdout,
    stderr: undefined,
    collected: {},
    done,
    terminate,
    waitForExit,
  }
  return {
    handle,
    stdin,
    stdout,
    settle,
    fail,
    terminate,
    waitForExit,
  }
}

function success(
  result = 'answer',
  isError = false,
): SDKResultMessage {
  return {
    type: 'result',
    subtype: 'success',
    is_error: isError,
    result,
  } as SDKResultMessage
}

type ErrorSubtype = Exclude<SDKResultMessage['subtype'], 'success'>

function failure(
  subtype: ErrorSubtype,
  errors: string[] = ['fixture failure'],
): SDKResultMessage {
  return {
    type: 'result',
    subtype,
    is_error: true,
    errors,
  } as SDKResultMessage
}

function queryFrom(
  messages: readonly SDKMessage[],
  after?: Error,
  close = vi.fn(),
): Query {
  async function* stream(): AsyncGenerator<SDKMessage, void> {
    for (const message of messages) yield message
    if (after !== undefined) throw after
  }
  return Object.assign(stream(), { close }) as unknown as Query
}

function waitingQuery(signal: AbortSignal, close = vi.fn()): Query {
  async function* stream(): AsyncGenerator<SDKMessage, void> {
    await new Promise<never>((_resolve, reject) => {
      const fail = (): void => {
        reject(signal.reason instanceof Error
          ? signal.reason
          : new Error(String(signal.reason)))
      }
      if (signal.aborted) fail()
      else signal.addEventListener('abort', fail, { once: true })
    })
  }
  return Object.assign(stream(), { close }) as unknown as Query
}

function sdkSpawnOptions(
  overrides: Partial<SpawnOptions> = {},
): SpawnOptions {
  return {
    command: '/sdk/claude',
    args: ['--output-format', 'stream-json'],
    cwd: '/workspace',
    env: { PATH: '/bin', OMITTED: undefined },
    signal: new AbortController().signal,
    ...overrides,
  }
}

interface FakeRun {
  readonly child: FakeChild
  readonly close: ReturnType<typeof vi.fn>
  readonly spawnSpecs: SubprocessSpawnSpec[]
  readonly options: Options[]
  readonly spec: ClaudeCodeRunSpec
}

function fakeRun(
  messages: readonly SDKMessage[] = [success()],
  after?: Error,
  child = fakeChild(),
): FakeRun {
  const close = vi.fn()
  const query = queryFrom(messages, after, close)
  const spawnSpecs: SubprocessSpawnSpec[] = []
  const options: FakeRun['options'] = []
  const spec: ClaudeCodeRunSpec = {
    cwd: '/workspace',
    executable: '/native/claude',
    env: { ANTHROPIC_API_KEY: 'fake-key' },
    disposeGraceMs: 5,
    spawn: (spawnSpec) => {
      spawnSpecs.push(spawnSpec)
      return child.handle
    },
  }
  queryMock.mockImplementation((params) => {
    options.push(params.options)
    params.options.spawnClaudeCodeProcess!(sdkSpawnOptions())
    return query
  })
  return { child, close, spawnSpecs, options, spec }
}

beforeEach(() => {
  queryMock.mockImplementation(({ options }) => {
    options.spawnClaudeCodeProcess!(sdkSpawnOptions({
      cwd: options.cwd!,
      env: options.env!,
      signal: options.abortController!.signal,
    }))
    return queryFrom([])
  })
})

afterEach(() => {
  queryMock.mockReset()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('task admission and package contracts', () => {
  it('preserves text sequences and rejects empty, blank, and non-text tasks', () => {
    expect(textTask([
      { type: 'text', text: 'one' },
      { type: 'text', text: 'two' },
    ])).toBe('onetwo')
    expect(() => textTask([])).toThrow('only text blocks')
    expect(() => textTask([{ type: 'reasoning', text: 'hidden' }]))
      .toThrow('only text blocks')
    expect(() => textTask([{ type: 'text', text: ' \n ' }]))
      .toThrow('must not be empty')
  })

  it('registers one fixed descriptor, validates config, and unregisters on HMR', async () => {
    const ctx = new Context()
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(LocalSubprocessRuntime)
    const fiber = await ctx.plugin(claudeCode, {})
    expect(ctx.subagents.getProvider('claude-code')).toMatchObject({
      name: 'claude-code',
      capabilities: {
        outputSchema: false,
        depthLimit: false,
        toolFilter: false,
        persona: false,
      },
      inheritsParentContext: false,
    })
    expect(ctx.subagents.list()).toEqual(['claude-code'])
    await fiber.dispose()
    expect(ctx.subagents.list()).toEqual([])

    for (const disposeGraceMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(ctx.plugin(claudeCode, { disposeGraceMs }))
        .rejects.toThrow('disposeGraceMs must be a positive finite number')
    }
    await expect(ctx.plugin(claudeCode, {
      disposeGraceMs: MAX_TIMER_DELAY_MS + 1,
    })).rejects.toThrow(
      `disposeGraceMs must be no greater than ${MAX_TIMER_DELAY_MS}`,
    )
    await ctx.fiber.dispose()
  })

  it('starts through the registered provider with its resolved config and diagnostics', async () => {
    const ctx = new Context()
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(LocalSubprocessRuntime)
    const child = fakeChild()
    const spawn = vi.spyOn(ctx.subprocess, 'spawn')
      .mockImplementation(() => child.handle)
    const resolveExecutable = vi.spyOn(ctx.subprocess, 'resolveExecutable')
      .mockResolvedValue('/native/claude')
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    await ctx.plugin(claudeCode, {
      env: {
        ANTHROPIC_API_KEY: 'provider-fake-key',
        CLAUDE_CONFIG_DIR: '/private/tmp/dsh-claude-code-unit-config',
        HOME: '/private/tmp/dsh-claude-code-unit-home',
      },
      disposeGraceMs: 29,
    })

    await expect(ctx.subagents.start('claude-code', {
      ...request(),
      parent: {
        id: 'parent-without-cwd',
        session: { header: {} },
      } as unknown as Agent,
    })).rejects.toThrow(
      'subagent-claude-code: no working directory for the child — delegate from a parent session that has one',
    )
    expect(queryMock).not.toHaveBeenCalled()

    resolveExecutable.mockRejectedValueOnce(new Error('claude missing from PATH'))
    await expect(ctx.subagents.start('claude-code', request()))
      .rejects.toThrow('claude missing from PATH')
    expect(queryMock).not.toHaveBeenCalled()

    const run = await ctx.subagents.start('claude-code', request())
    child.settle({ exitCode: 9, signal: null })
    child.stdout.end()
    await expect(run.result).resolves.toEqual({
      output: [],
      stopReason: 'error',
    })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(
      'subagent-claude-code: child run failed (error):',
    ))
    expect(resolveExecutable).toHaveBeenCalledWith(
      'claude',
      expect.objectContaining({ ANTHROPIC_API_KEY: 'provider-fake-key' }),
      expect.any(AbortSignal),
    )
    expect(queryMock.mock.calls[0]?.[0].options.pathToClaudeCodeExecutable)
      .toBe('/native/claude')
    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({
      cwd: process.cwd(),
      graceMs: 29,
    }))
    expect(spawn.mock.calls[0]?.[0].env).toMatchObject({
      ANTHROPIC_API_KEY: 'provider-fake-key',
    })
    await run.dispose()
    await ctx.fiber.dispose()
  })

  it('keeps the Loader namespace shape and package-owned empty invariant', async () => {
    expect('default' in claudeCode).toBe(false)
    expect(claudeCode.name).toBe('subagent-claude-code')
    expect(claudeCode.inject).toEqual(['subagents', 'subprocess'])
    const loader = Object.create(Loader.prototype) as Loader
    expect(loader.unwrapExports(claudeCode)).toBe(claudeCode)

    const dispose = vi.fn()
    const register = vi.fn((
      _packageName: string,
      _installer: InvariantInstaller,
    ) => dispose)
    const ctx = { invariants: { register } } as unknown as Context
    await expect(invariant.apply(ctx)).resolves.toBe(dispose)
    expect(register).toHaveBeenCalledWith(
      '@deepseek-ai/dsh-subagent-claude-code',
      expect.any(Function),
    )
    const install = register.mock.calls[0]![1]
    await install(new Context(), (message) => { throw new Error(message) })
    expect(invariant.name).toBe('subagent-claude-code-invariant')
    expect(invariant.inject).toEqual(['invariants'])
  })
})

describe('official spawn projection', () => {
  it('forwards command, arguments, cwd, environment, and signal exactly', () => {
    vi.stubEnv('SDK_REMOVED_AMBIENT', 'ambient-value')
    const signal = new AbortController().signal
    const options = sdkSpawnOptions({
      command: '/official/claude',
      args: ['--one', 'two'],
      cwd: '/parent/workspace',
      env: { A: 'one', B: undefined, C: 'three' },
      signal,
    })
    expect(sdkEnvironmentOverlay(options.env)).toEqual(expect.objectContaining({
      A: 'one',
      B: undefined,
      C: 'three',
      SDK_REMOVED_AMBIENT: undefined,
    }))
    const spawnSpec = claudeSpawnSpec(options, 321)
    expect(spawnSpec).toMatchObject({
      argv: ['/official/claude', '--one', 'two'],
      cwd: '/parent/workspace',
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'inherit' },
      graceMs: 321,
      signal,
    })
    expect(spawnSpec.env).toEqual(expect.objectContaining({
      A: 'one',
      B: undefined,
      C: 'three',
      SDK_REMOVED_AMBIENT: undefined,
    }))
    const missingCwd = sdkSpawnOptions()
    delete missingCwd.cwd
    expect(() => claudeSpawnSpec(
      missingCwd,
      321,
    )).toThrow('SDK spawn request omitted its workspace')
    expect(() => claudeSpawnSpec(
      sdkSpawnOptions({ cwd: '' }),
      321,
    )).toThrow('SDK spawn request omitted its workspace')
  })

  it.each(['cmd', 'bat'])('routes a Windows .%s shim through cmd.exe', (extension) => {
    const command = String.raw`C:\Program Files\Claude\claude.${extension}`
    const spec = claudeSpawnSpec(sdkSpawnOptions({
      command,
      args: ['--output-format', 'stream-json'],
    }), 7, 'win32')

    expect(spec.argv).toEqual([
      'cmd.exe', '/d', '/v:off', '/s', '/c', '%DSH_CLAUDE_CODE_EXECUTABLE%',
      '--output-format', 'stream-json',
    ])
    expect(spec.env).toEqual(expect.objectContaining({
      DSH_CLAUDE_CODE_EXECUTABLE: `"${command}"`,
    }))
  })

  it('projects streams, exit facts, listeners, and idempotent tree termination', async () => {
    const child = fakeChild({ exitOnTerminate: false })
    const process = new ManagedClaudeCodeProcess(child.handle)
    expect(process.stdin).toBe(child.stdin)
    expect(process.stdout).toBe(child.stdout)
    expect(process.killed).toBe(false)
    expect(process.exitCode).toBeNull()
    expect(process.signalCode).toBeNull()

    const exit = vi.fn()
    const once = vi.fn()
    const removed = vi.fn()
    process.on('exit', exit)
    process.once('exit', once)
    process.on('exit', removed)
    process.off('exit', removed)
    expect(process.kill('SIGTERM')).toBe(true)
    expect(process.killed).toBe(true)
    expect(process.kill('SIGKILL')).toBe(false)
    expect(child.terminate).toHaveBeenCalledOnce()

    child.settle({ exitCode: null, signal: 'SIGTERM' })
    await nextTask()
    expect(exit).toHaveBeenCalledWith(null, 'SIGTERM')
    expect(once).toHaveBeenCalledOnce()
    expect(removed).not.toHaveBeenCalled()
    expect(process.signalCode).toBe('SIGTERM')
    expect(process.kill('SIGTERM')).toBe(false)
  })

  it('emits spawn errors', async () => {
    const child = fakeChild()
    const process = new ManagedClaudeCodeProcess(child.handle)
    const errorListener = vi.fn()
    const removed = vi.fn()
    process.once('error', errorListener)
    process.on('error', removed)
    process.off('error', removed)
    child.fail(new Error('spawn boom'))
    await nextTask()
    expect(errorListener).toHaveBeenCalledWith(expect.objectContaining({
      message: 'spawn boom',
    }))
    expect(removed).not.toHaveBeenCalled()
  })

  it('exposes a settled direct-child exit code', async () => {
    const child = fakeChild()
    const process = new ManagedClaudeCodeProcess(child.handle)
    child.settle({ exitCode: 7, signal: null })
    await nextTask()
    expect(process.exitCode).toBe(7)
    expect(process.signalCode).toBeNull()
    expect(process.kill('SIGTERM')).toBe(false)
  })
})

describe('query options and result mapping', () => {
  it('builds the fixed unattended options over the scrubbed environment', () => {
    vi.stubEnv('HOST_VISIBLE', 'visible')
    vi.stubEnv('HOST_SECRET_TOKEN', 'must-not-leak')
    vi.stubEnv('DSH_INTERNAL', 'must-not-leak')
    const child = fakeChild()
    const spawn = vi.fn(() => child.handle)
    const captured: SubprocessHandle[] = []
    const spec: ClaudeCodeRunSpec = {
      cwd: '/workspace',
      executable: '/native/claude',
      env: {
        HOST_VISIBLE: 'overridden',
        ANTHROPIC_API_KEY: 'explicit-fake-key',
      },
      disposeGraceMs: 17,
      spawn,
    }
    const controller = new AbortController()
    const options = claudeQueryOptions(spec, controller, (value) => {
      captured.push(value)
    })

    expect(options).toMatchObject({
      abortController: controller,
      cwd: '/workspace',
      pathToClaudeCodeExecutable: '/native/claude',
      persistSession: false,
      disallowedTools: ['AskUserQuestion'],
    })
    expect(options.env).toMatchObject({
      HOST_VISIBLE: 'overridden',
      ANTHROPIC_API_KEY: 'explicit-fake-key',
    })
    expect(options.env).not.toHaveProperty('HOST_SECRET_TOKEN')
    expect(options.env).not.toHaveProperty('DSH_INTERNAL')
    for (const omitted of [
      'settingSources',
      'canUseTool',
      'onElicitation',
      'onUserDialog',
      'supportedDialogKinds',
    ]) {
      expect(options).not.toHaveProperty(omitted)
    }

    const spawned = options.spawnClaudeCodeProcess!(sdkSpawnOptions())
    expect(spawned).toBeInstanceOf(ManagedClaudeCodeProcess)
    expect(captured).toEqual([child.handle])
    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({
      argv: ['/sdk/claude', '--output-format', 'stream-json'],
      cwd: '/workspace',
      graceMs: 17,
    }))
  })

  it('accepts only a non-error success with a non-blank final result', () => {
    expect(successfulResult(success('exact final'))).toBe('exact final')
    expect(() => successfulResult(success('answer', true)))
      .toThrow('marked as an error')
    expect(() => successfulResult(success(' \n ')))
      .toThrow('contained no answer')
    expect(() => successfulResult(failure(
      'error_during_execution',
      ['first', 'second'],
    ))).toThrow('first; second')
    expect(() => successfulResult(failure(
      'error_max_turns',
      [],
    ))).toThrow('error_max_turns')
  })

  it('consumes the complete stream and keeps the latest strict success', async () => {
    const query = queryFrom([
      { type: 'system', subtype: 'init' } as SDKMessage,
      success('first'),
      success('last'),
    ])
    await expect(consumeClaudeQuery(query)).resolves.toEqual({
      output: [{ type: 'text', text: 'last' }],
      stopReason: 'completed',
    })
    await expect(consumeClaudeQuery(
      queryFrom([{ type: 'system', subtype: 'init' } as SDKMessage]),
    )).rejects.toThrow('ended without a result')
  })
})

describe('run publication, cancellation, and settlement', () => {
  it('publishes only after Query and managed child exist, then disposes once', async () => {
    const fixture = fakeRun([success('exact answer')])
    const run = await startClaudeCodeRun(
      request([
        { type: 'text', text: 'first' },
        { type: 'text', text: 'second' },
      ]),
      fixture.spec,
    )
    expect(fixture.options).toHaveLength(1)
    expect(fixture.spawnSpecs).toHaveLength(1)
    await expect(run.result).resolves.toEqual({
      output: [{ type: 'text', text: 'exact answer' }],
      stopReason: 'completed',
    })
    const first = run.dispose()
    const second = run.dispose()
    expect(second).toBe(first)
    await first
    expect(fixture.close).toHaveBeenCalledOnce()
    expect(fixture.child.terminate).toHaveBeenCalledOnce()
  })

  it('flattens every SDK error result without inventing shared stop reasons', async () => {
    const subtypes: ErrorSubtype[] = [
      'error_during_execution',
      'error_max_turns',
      'error_max_budget_usd',
      'error_max_structured_output_retries',
    ]
    for (const subtype of subtypes) {
      const fixture = fakeRun([failure(subtype)])
      const onError = vi.fn()
      const run = await startClaudeCodeRun(
        request(),
        { ...fixture.spec, onError },
      )
      await expect(run.result).resolves.toEqual({
        output: [],
        stopReason: 'error',
      })
      expect(onError).toHaveBeenCalledWith(
        expect.any(Error),
        'error',
      )
      await run.dispose()
    }
  })

  it('fails closed when iteration rejects after a result', async () => {
    const fixture = fakeRun(
      [success('partial final')],
      new Error('iterator boom'),
    )
    const run = await startClaudeCodeRun(request(), fixture.spec)
    await expect(run.result).resolves.toEqual({
      output: [],
      stopReason: 'error',
    })
    await run.dispose()
  })

  it('maps invalid success and missing result to error', async () => {
    for (const messages of [
      [success('answer', true)],
      [success('')],
      [{ type: 'system', subtype: 'init' } as SDKMessage],
    ]) {
      const fixture = fakeRun(messages)
      const run = await startClaudeCodeRun(request(), fixture.spec)
      await expect(run.result).resolves.toMatchObject({
        stopReason: 'error',
      })
      await run.dispose()
    }
  })

  it('gives local cancellation precedence and isolates overlapping controllers', async () => {
    const firstChild = fakeChild()
    const secondChild = fakeChild()
    const children = [firstChild, secondChild]
    const controllers: AbortController[] = []
    let index = 0
    const spec: ClaudeCodeRunSpec = {
      cwd: '/workspace',
      executable: '/native/claude',
      env: {},
      disposeGraceMs: 5,
      spawn: () => children[index++]!.handle,
    }
    queryMock.mockImplementation(({ prompt, options }) => {
      controllers.push(options.abortController!)
      options.spawnClaudeCodeProcess!(sdkSpawnOptions())
      return prompt === 'wait'
        ? waitingQuery(options.abortController!.signal)
        : queryFrom([success('second answer')])
    })
    const firstAbort = new AbortController()
    const first = await startClaudeCodeRun(
      request([{ type: 'text', text: 'wait' }], firstAbort.signal),
      spec,
    )
    const second = await startClaudeCodeRun(
      request([{ type: 'text', text: 'finish' }]),
      spec,
    )
    expect(controllers).toHaveLength(2)
    expect(controllers[0]).not.toBe(controllers[1])
    firstAbort.abort(new Error('parent cancelled'))
    await expect(first.result).resolves.toEqual({
      output: [],
      stopReason: 'aborted',
    })
    await expect(second.result).resolves.toEqual({
      output: [{ type: 'text', text: 'second answer' }],
      stopReason: 'completed',
    })
    expect(controllers[1]!.signal.aborted).toBe(false)
    await Promise.all([first.dispose(), second.dispose()])
  })

  it('keeps local cancellation authoritative when the SDK iterator ends normally', async () => {
    const parentAbort = new AbortController()
    const child = fakeChild()
    async function* stream(): AsyncGenerator<SDKMessage, void> {
      yield success('candidate answer')
      parentAbort.abort(new Error('parent cancelled at iterator completion'))
    }
    queryMock.mockImplementation(({ options }) => {
      options.spawnClaudeCodeProcess!(sdkSpawnOptions())
      return Object.assign(stream(), { close: vi.fn() }) as unknown as Query
    })
    const run = await startClaudeCodeRun(
      request(undefined, parentAbort.signal),
      {
        cwd: '/workspace',
        executable: '/native/claude',
        env: {},
        disposeGraceMs: 5,
        spawn: () => child.handle,
      },
    )
    await expect(run.result).resolves.toEqual({
      output: [],
      stopReason: 'aborted',
    })
    await run.dispose()
  })

  it('rejects pre-abort and every incomplete startup transaction', async () => {
    const preAborted = new AbortController()
    preAborted.abort()
    const unused = fakeRun()
    await expect(startClaudeCodeRun(
      request(undefined, preAborted.signal),
      unused.spec,
    )).rejects.toThrow('aborted before SDK startup')
    expect(unused.options).toEqual([])

    const noChildClose = vi.fn()
    queryMock.mockImplementationOnce(
      () => queryFrom([], undefined, noChildClose),
    )
    await expect(startClaudeCodeRun(request(), {
      ...unused.spec,
    })).rejects.toThrow('did not publish a controllable')
    expect(noChildClose).toHaveBeenCalledOnce()

    const closeFailure = vi.fn(() => { throw new Error('close boom') })
    queryMock.mockImplementationOnce(
      () => queryFrom([], undefined, closeFailure),
    )
    const noChild = startClaudeCodeRun(request(), {
      ...unused.spec,
    })
    await expect(noChild).rejects.toBeInstanceOf(AggregateError)

    const startupAbort = new AbortController()
    const abortedChild = fakeChild()
    const abortedClose = vi.fn()
    queryMock.mockImplementationOnce(({ options }) => {
      options.spawnClaudeCodeProcess!(sdkSpawnOptions())
      startupAbort.abort(new Error('startup cancelled'))
      return queryFrom([], undefined, abortedClose)
    })
    const abortedDuringStartup = startClaudeCodeRun(
      request(undefined, startupAbort.signal),
      {
        ...unused.spec,
        spawn: () => abortedChild.handle,
      },
    )
    await expect(abortedDuringStartup)
      .rejects.toThrow('aborted before SDK startup')
    expect(abortedClose).toHaveBeenCalledOnce()
    expect(abortedChild.terminate).toHaveBeenCalledOnce()

    queryMock.mockImplementationOnce(() => {
      throw new Error('query failed before resource creation')
    })
    await expect(startClaudeCodeRun(request(), {
      ...unused.spec,
    })).rejects.toThrow('query failed before resource creation')

    const spawned = fakeChild()
    const spawnSpecs: SubprocessSpawnSpec[] = []
    let factoryController: AbortController | undefined
    queryMock.mockImplementationOnce(({ options }) => {
      factoryController = options.abortController
      options.spawnClaudeCodeProcess!(sdkSpawnOptions())
      throw new Error('query construction failed')
    })
    const factoryFailure = startClaudeCodeRun(request(), {
      ...unused.spec,
      spawn: (spawnSpec) => {
        spawnSpecs.push(spawnSpec)
        return spawned.handle
      },
    })
    await expect(factoryFailure).rejects.toThrow('query construction failed')
    expect(spawnSpecs).toHaveLength(1)
    expect(factoryController?.signal.aborted).toBe(true)
    expect(spawned.terminate).toHaveBeenCalledOnce()

    const failedSpawn = fakeChild({
      pid: -1,
      doneError: new Error('spawn failed'),
    })
    const failed = fakeRun([], undefined, failedSpawn)
    await expect(startClaudeCodeRun(request(), failed.spec))
      .rejects.toBeInstanceOf(AggregateError)
    expect(failed.close).toHaveBeenCalledOnce()
  })
})

describe('query and process disposal', () => {
  it('closes the query, terminates the tree, and waits for direct-child outcome', async () => {
    const child = fakeChild()
    const close = vi.fn()
    await disposeClaudeCodeChild({ close }, child.handle)
    expect(close).toHaveBeenCalledOnce()
    expect(child.terminate).toHaveBeenCalledOnce()
    expect(child.waitForExit).toHaveBeenCalledOnce()
    expect(child.waitForExit).toHaveBeenCalledWith()
    await expect(child.handle.done).resolves.toEqual({
      exitCode: 0,
      signal: null,
    })
  })

  it('does not finish disposal before the managed tree exits', async () => {
    const child = fakeChild({ exitOnTerminate: false })
    let disposed = false
    const disposal = disposeClaudeCodeChild(
      { close: vi.fn() },
      child.handle,
    ).then(() => {
      disposed = true
    })
    await nextTask()
    expect(disposed).toBe(false)
    child.settle()
    await disposal
    expect(disposed).toBe(true)
  })

  it('reports wait, close, and direct-child failures without skipping cleanup', async () => {
    const waitFailure = fakeChild({
      waitForExitError: new Error('wait boom'),
    })
    const closeFailure = vi.fn(() => { throw new Error('close boom') })
    await expect(disposeClaudeCodeChild(
      { close: closeFailure },
      waitFailure.handle,
    )).rejects.toBeInstanceOf(AggregateError)
    expect(waitFailure.terminate).toHaveBeenCalledOnce()

    const doneFailure = fakeChild({
      pid: -1,
      doneError: new Error('spawn boom'),
    })
    await expect(disposeClaudeCodeChild(
      { close: vi.fn() },
      doneFailure.handle,
    )).rejects.toThrow('spawn boom')

    const both = fakeChild({
      pid: -1,
      doneError: new Error('spawn boom'),
    })
    await expect(disposeClaudeCodeChild(
      { close: () => { throw new Error('close boom') } },
      both.handle,
    )).rejects.toBeInstanceOf(AggregateError)
  })
})
