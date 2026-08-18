/**
 * SDK client against a real scripted runtime subprocess
 * (`tests/fake-runtime.ts`, protocol-only — the only faked boundary is the
 * model-owning runtime itself). Covers the turn loop, notification routing
 * and session-tree scoping, error surfaces, timeouts, and the dispose ladder.
 */

import { mkdir, mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DeepSeekHarness,
  HarnessClient,
  HarnessSession,
  JsonRpcResponseError,
  RequestTimeoutError,
  SdkProtocolError,
  TransportClosedError,
  type HarnessNotification,
} from '../src/index.ts'
import { finalResponse, normalizeInput } from '../src/api.ts'

const fakeRuntime = fileURLToPath(new URL('./fake-runtime.ts', import.meta.url))

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

type LaunchOverrides = Partial<ConstructorParameters<typeof HarnessClient>[0]>

/** Launch options running the fake runtime on the current node (type stripping). */
function fakeLaunch(env: Record<string, string> = {}, extra: LaunchOverrides = {}) {
  return {
    command: process.execPath,
    args: [fakeRuntime],
    env: { ...process.env as Record<string, string>, ...env },
    ...extra,
  }
}

function harnessWith(env: Record<string, string> = {}, extra: LaunchOverrides = {}): DeepSeekHarness {
  const harness = new DeepSeekHarness({ launch: fakeLaunch(env, extra) })
  cleanups.push(() => harness.close())
  return harness
}

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

describe('DeepSeekHarness', () => {
  it('ignores notifications that precede the submitted message receipt', async () => {
    const notifications = [
      { method: 'session.status', params: { sessionId: 'owned', status: 'running' } },
      {
        method: 'session.event',
        params: { sessionId: 'owned', event: { type: 'turn/start', data: { turn: 1 } } },
      },
      {
        method: 'session.event',
        params: {
          sessionId: 'owned',
          event: { type: 'agent/inbox/spliced', data: { inserted: null } },
        },
      },
      {
        method: 'session.event',
        params: {
          sessionId: 'owned',
          event: {
            type: 'agent/inbox/spliced',
            seq: 0,
            time: 0,
            data: {
              target: 'next-turn',
              start: 0,
              inserted: [{ id: 'accepted-message', role: 'user', content: [], source: { kind: 'user' } }],
            },
          },
        },
      },
      { method: 'session.status', params: { sessionId: 'owned', status: 'idle' } },
    ] as HarnessNotification[]
    let closed = false
    const harness = {
      start: () => Promise.resolve(),
      client: {
        prompt: () => Promise.resolve('accepted-message'),
        subscribeSessionTree: () => ({
          next: async () => {
            const notification = notifications.shift()
            if (notification === undefined) throw new Error('scripted notification queue exhausted')
            return notification
          },
          tryNext: () => notifications.shift(),
          close: () => { closed = true },
          async * [Symbol.asyncIterator]() {},
        }),
      },
    } as unknown as DeepSeekHarness

    const result = await new HarnessSession(harness, 'owned').run('go')

    expect(result.notifications.map(notification => notification.method))
      .toEqual(['session.event', 'session.status'])
    expect(result.events.map(event => event.type)).toEqual(['agent/inbox/spliced'])
    expect(closed).toBe(true)
  })

  it('runs a turn end to end and reuses the runtime across sessions', async () => {
    const harness = harnessWith({ FAKE_TEXT: 'turn answer' })
    const first = await harness.run('say hi')
    expect(first.finalResponse).toBe('turn answer')
    expect(first.events.map(event => event.type)).toEqual([
      'agent/inbox/spliced', 'turn/start', 'assistant/chunk', 'assistant/message', 'turn/end',
    ])

    // Same subprocess, second session: ids differ, protocol state is reusable.
    const second = await harness.run([{ type: 'text', text: 'again' }])
    expect(second.sessionId).not.toBe(first.sessionId)
    await harness.close()
  })

  it('keeps events root-scoped while streaming notifications for the session tree', async () => {
    const harness = harnessWith({ FAKE_SUBAGENT: '1' })
    const seen: HarnessNotification[] = []
    const result = await harness.run('delegate', {
      sessionId: 'parent-1',
      onNotification: (n) => { seen.push(n) },
    })

    // The child session's events arrive through subagent.started lineage.
    expect(seen.map(n => n.method)).toContain('subagent.started')
    expect(seen.map(n => n.method)).toContain('subagent.finished')
    const childEvents = seen.filter(n => n.method === 'session.event' && n.params.sessionId === 'parent-1-child')
    expect(childEvents.length).toBeGreaterThan(0)
    // RunResult.events is the root session's typed stream; descendants retain
    // their session ids in the raw notification stream above.
    expect(result.events.every(event => event.type !== 'assistant/message'
      || event.data.message.content[0]?.type !== 'text'
      || event.data.message.content[0].text !== 'child says hi')).toBe(true)
    await harness.close()
  })

  it('sends the configured cwd/provider/model/maxTokens in the handshake exactly once', async () => {
    const dir = await tempDir('sdk-client-init-')
    const recordFile = join(dir, 'init.jsonl')
    const harness = new DeepSeekHarness({
      launch: fakeLaunch({ FAKE_RECORD_INIT: recordFile }),
      cwd: dir,
      provider: 'custom-provider',
      model: 'custom-model',
      maxTokens: 4096,
    })
    cleanups.push(() => harness.close())
    await harness.run('one')
    await harness.run('two')
    await harness.close()
    const records = (await readFile(recordFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as object)
    expect(records).toEqual([{
      cwd: dir,
      provider: 'custom-provider',
      model: 'custom-model',
      maxTokens: 4096,
    }])
  })

  it('resolves a relative launch cwd to an absolute workspace before the handshake', async () => {
    // vitest workers forbid chdir, so derive a RELATIVE path from the real
    // process cwd to a temp worker dir; resolution is lexical either way.
    const dir = await mkdtemp(join(process.cwd(), '.dsh-sdk-client-relcwd-'))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    const recordFile = join(dir, 'init.jsonl')
    const inner = join(dir, 'worker')
    await mkdir(inner)
    const relativeCwd = relative(process.cwd(), inner)
    expect(isAbsolute(relativeCwd)).toBe(false)
    const harness = new DeepSeekHarness({
      launch: fakeLaunch({ FAKE_RECORD_INIT: recordFile, FAKE_ECHO_CWD_IN_INIT: '1' }, { cwd: relativeCwd }),
    })
    cleanups.push(() => harness.close())
    await harness.start()
    const identity = await harness.client.initialize({ cwd: inner, provider: 'p', model: 'm' })
    await harness.close()
    // The child spawned under the temp worker dir (its physical cwd)...
    expect(identity.serverInfo.version).toBe(await realpath(inner))
    // ...and the handshake wire cwd went out ABSOLUTE, so the child cannot
    // re-resolve a relative string into dir/worker/worker.
    const records = (await readFile(recordFile, 'utf8')).trim().split('\n')
      .map(line => (JSON.parse(line) as { cwd: string }).cwd)
    expect(records).toEqual([resolvePath(relativeCwd), inner])
  })

  it('propagates a JSON-RPC error response from initialize and closes the runtime', async () => {
    const harness = harnessWith({ FAKE_INIT_ERROR: '1' })
    const failure = await harness.run('boom').then(
      () => { throw new Error('run unexpectedly succeeded') },
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(JsonRpcResponseError)
    expect(failure).toMatchObject({ code: 7, message: 'scripted init failure', data: { hint: 'fake' } })
    // The failed handshake reset lets a later start retry instead of wedging.
    await expect(harness.run('later')).rejects.toThrow()
  })

  it('retries a failed handshake with a fresh runtime process', async () => {
    const dir = await tempDir('sdk-client-retry-')
    const marker = join(dir, 'first-boot-failed')
    const harness = harnessWith({ FAKE_INIT_ERROR_ONCE_FILE: marker, FAKE_TEXT: 'second boot answer' })
    const firstClient = harness.client
    // First start: the scripted runtime fails the handshake and is reaped.
    await expect(harness.start()).rejects.toThrow('scripted first-boot failure')
    // Retry spawns a NEW subprocess through a fresh client (close is permanent).
    const result = await harness.run('again')
    expect(harness.client).not.toBe(firstClient)
    expect(result.finalResponse).toBe('second boot answer')
    await harness.close()
    // close() is terminal: a handshake failure after it must not respawn.
    await expect(harness.run('after-close')).rejects.toThrow(TransportClosedError)
  })

  it('rejects a malformed initialize result as a protocol error', async () => {
    const harness = harnessWith({ FAKE_MALFORMED: '1' })
    await expect(harness.run('bad')).rejects.toThrow(SdkProtocolError)
  })

  it('supports await using disposal', async () => {
    let captured: DeepSeekHarness
    {
      await using harness = new DeepSeekHarness({ launch: fakeLaunch() })
      captured = harness
      const result = await harness.run('scoped')
      expect(result.finalResponse).toBe('hello from fake runtime')
    }
    // After scope exit the runtime is closed: reuse fails loudly.
    await expect(captured.run('after')).rejects.toThrow(TransportClosedError)
  })
})

describe('HarnessClient', () => {
  it('times out a hung request at the per-call bound', async () => {
    const client = new HarnessClient(fakeLaunch({ FAKE_HANG_PROMPT: '1' }))
    cleanups.push(() => client.close())
    await client.initialize({ cwd: process.cwd(), provider: 'p', model: 'm' })
    await expect(client.request('session/prompt', { sessionId: 's', contentBlocks: normalizeInput('hi') }, 200))
      .rejects.toThrow(RequestTimeoutError)
    await client.close()
  })

  it('a timed-out request leaves no pending transport state', async () => {
    const client = new HarnessClient(fakeLaunch({ FAKE_HANG_PROMPT: '1' }))
    cleanups.push(() => client.close())
    await client.initialize({ cwd: process.cwd(), provider: 'p', model: 'm' })
    for (let round = 0; round < 3; round++) {
      await expect(client.request('session/prompt', { sessionId: 's', contentBlocks: normalizeInput('x') }, 50))
        .rejects.toThrow(RequestTimeoutError)
    }
    // Abandonment removed each pending entry at its timeout; a hung method
    // retains nothing per call. (Private map read is the observable here —
    // no wire surface reports transport bookkeeping.)
    const transport = (client as unknown as { transport: { pending: Map<string, unknown> } }).transport
    expect(transport.pending.size).toBe(0)
    await client.close()
  })

  it('applies the client-wide request timeout when no per-call bound is given', async () => {
    const client = new HarnessClient(fakeLaunch({ FAKE_HANG_PROMPT: '1' }, { requestTimeoutMs: 400 }))
    cleanups.push(() => client.close())
    // The bound applies from send, so it holds regardless of runtime boot time.
    await expect(client.prompt('s', normalizeInput('hi'))).rejects.toThrow(RequestTimeoutError)
    await client.close()
  })

  it('rejects a malformed prompt acceptance as a protocol error', async () => {
    const client = new HarnessClient(fakeLaunch({ FAKE_MALFORMED: '1' }))
    cleanups.push(() => client.close())
    await expect(client.prompt('s', normalizeInput('hi'))).rejects.toThrow(SdkProtocolError)
    await client.close()
  })

  it('fails pending requests with exit code and stderr tail when the runtime dies', async () => {
    const client = new HarnessClient(fakeLaunch({ FAKE_EXIT_BEFORE_INIT: '1', FAKE_STDERR: 'fatal: scripted death' }))
    cleanups.push(() => client.close())
    const failure = await client.initialize({ cwd: process.cwd(), provider: 'p', model: 'm' }).then(
      () => { throw new Error('initialize unexpectedly succeeded') },
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(TransportClosedError)
    expect(String(failure)).toContain('exit code: 3')
    expect(String(failure)).toContain('fatal: scripted death')
    // Requests after death fail immediately with the same context.
    await expect(client.request('initialize', {})).rejects.toThrow('exit code: 3')
  })

  it('flushes an unterminated stderr line into the tail at close', async () => {
    const client = new HarnessClient(fakeLaunch({ FAKE_STDERR_NO_NEWLINE: 'no trailing newline', FAKE_EXIT_BEFORE_INIT: '1' }))
    cleanups.push(() => client.close())
    const failure = await client.initialize({ cwd: process.cwd(), provider: 'p', model: 'm' }).then(
      () => { throw new Error('initialize unexpectedly succeeded') },
      (error: unknown) => error,
    )
    expect(String(failure)).toContain('no trailing newline')
  })

  it('fails fast when the command does not exist', async () => {
    const client = new HarnessClient({ command: join(tmpdir(), 'dsh-no-such-runtime-bin') })
    cleanups.push(() => client.close())
    await expect(client.request('initialize', {}, 1_000)).rejects.toThrow(TransportClosedError)
  })

  it('close() is idempotent, reaps the child, and fails later use', async () => {
    const client = new HarnessClient(fakeLaunch())
    await client.initialize({ cwd: process.cwd(), provider: 'p', model: 'm' })
    await Promise.all([client.close(), client.close()])
    expect(() => { client.start() }).toThrow(TransportClosedError)
    await expect(client.request('anything')).rejects.toThrow(TransportClosedError)
    // Close with no child ever spawned is a no-op.
    const untouched = new HarnessClient(fakeLaunch())
    await untouched.close()
  })

  it('escalates through SIGTERM when the runtime ignores EOF', async () => {
    const dir = await tempDir('sdk-client-ladder-')
    const sigtermFile = join(dir, 'sigterm.txt')
    const client = new HarnessClient(fakeLaunch(
      { FAKE_IGNORE_EOF: '1', FAKE_SIGTERM_FILE: sigtermFile },
      { shutdownTimeoutMs: 100, disposeEofGraceMs: 100, disposeGraceMs: 1_000 },
    ))
    await client.initialize({ cwd: process.cwd(), provider: 'p', model: 'm' })
    await client.close()
    if (process.platform === 'win32') {
      await expect(stat(sigtermFile)).rejects.toMatchObject({ code: 'ENOENT' })
    } else {
      expect((await stat(sigtermFile)).isFile()).toBe(true)
    }
  })

  it('escalates to SIGKILL when the runtime traps SIGTERM too', async () => {
    const client = new HarnessClient(fakeLaunch(
      { FAKE_IGNORE_EOF: '1', FAKE_TRAP_SIGTERM: '1' },
      { shutdownTimeoutMs: 100, disposeEofGraceMs: 100, disposeGraceMs: 300 },
    ))
    await client.initialize({ cwd: process.cwd(), provider: 'p', model: 'm' })
    // Resolves (does not hang or reject): the SIGKILL rung reaped the child.
    await client.close()
  })

  it('delivers notifications to unfiltered and filtered subscriptions in wire order', async () => {
    const client = new HarnessClient(fakeLaunch())
    cleanups.push(() => client.close())
    await client.initialize({ cwd: process.cwd(), provider: 'p', model: 'm' })

    const all = client.subscribe()
    const idleOnly = client.subscribe(n => n.method === 'session.status' && n.params.status === 'idle')
    const firstPending = all.next()
    await client.prompt('sub-test', normalizeInput('go'))

    const first = await firstPending
    expect(first.method).toBe('session.event')
    const idle = await idleOnly.next()
    expect(idle.method).toBe('session.status')
    expect(idleOnly.tryNext()).toBeUndefined()

    // A bare unbounded request with omitted params sends `{}` on the wire.
    const identity = await client.request('initialize') as { serverInfo: { name: string } }
    expect(identity.serverInfo.name).toBe('deepseek-harness-sdk-runtime')

    // Async iteration consumes queued items and then parks.
    const collected: string[] = []
    for await (const notification of all) {
      collected.push(notification.method)
      if (notification.method === 'session.status' && notification.params.status === 'idle') break
    }
    expect(collected.at(-1)).toBe('session.status')

    all.close()
    idleOnly.close()
    await expect(all.next()).rejects.toThrow('notification subscription closed')
    await client.close()
  })

  it('contains a throwing filter to its own subscription', async () => {
    const client = new HarnessClient(fakeLaunch())
    cleanups.push(() => client.close())
    await client.initialize({ cwd: process.cwd(), provider: 'p', model: 'm' })

    const broken = client.subscribe(() => { throw new Error('filter exploded') })
    // A non-Error throw is normalized rather than crashing dispatch.
    const brokenNonError = client.subscribe(() => { throw 'string boom' })
    const healthy = client.subscribe(n => n.method === 'session.status' && n.params.status === 'idle')
    await client.prompt('filter-contain', normalizeInput('go'))

    // The sibling subscription and the read loop are undisturbed.
    expect((await healthy.next()).method).toBe('session.status')
    // Each broken subscription failed with ITS OWN error and detached.
    await expect(broken.next()).rejects.toThrow('filter exploded')
    await expect(brokenNonError.next()).rejects.toThrow('string boom')
    healthy.close()
    await client.close()
  })

  it('close() drops queued notifications; runtime death keeps them drainable', async () => {
    const client = new HarnessClient(fakeLaunch())
    await client.initialize({ cwd: process.cwd(), provider: 'p', model: 'm' })
    const closed = client.subscribe()
    const drainable = client.subscribe()
    await client.prompt('queue-drop', normalizeInput('go'))
    expect(closed.tryNext()).toBeDefined()
    closed.close()
    // Manual close drops the rest of the queue outright.
    expect(closed.tryNext()).toBeUndefined()
    await expect(closed.next()).rejects.toThrow('notification subscription closed')
    // Runtime teardown, by contrast, only stops FUTURE delivery: what was
    // already delivered before close() stays drainable.
    await client.close()
    expect(drainable.tryNext()).toBeDefined()
  })

  it('subscriptions created after termination are born failed', async () => {
    const client = new HarnessClient(fakeLaunch())
    await client.initialize({ cwd: process.cwd(), provider: 'p', model: 'm' })
    await client.close()
    // No producer can ever feed this subscription; next() must not park forever.
    await expect(client.subscribe().next()).rejects.toThrow(TransportClosedError)

    const dead = new HarnessClient(fakeLaunch({ FAKE_EXIT_BEFORE_INIT: '1' }))
    cleanups.push(() => dead.close())
    await dead.initialize({ cwd: process.cwd(), provider: 'p', model: 'm' }).catch(() => {})
    await expect(dead.subscribe().next()).rejects.toThrow(TransportClosedError)
  })

  it('closes subscriptions with the runtime and rejects parked waiters', async () => {
    const client = new HarnessClient(fakeLaunch())
    await client.initialize({ cwd: process.cwd(), provider: 'p', model: 'm' })
    const subscription = client.subscribe()
    const parked = subscription.next()
    await client.close()
    await expect(parked).rejects.toThrow(TransportClosedError)
  })

  it('scopes the session tree across multi-hop lineage and ignores foreign sessions', async () => {
    const client = new HarnessClient(fakeLaunch())
    cleanups.push(() => client.close())
    await client.initialize({ cwd: process.cwd(), provider: 'p', model: 'm' })

    const tree = client.subscribeSessionTree('root')
    // Lineage edges arrive as subagent.started notifications.
    const inject = (method: string, params: Record<string, unknown>): void => {
      (client as unknown as { dispatchNotification(n: HarnessNotification): void }).dispatchNotification({ method, params })
    }
    inject('subagent.started', { parentSessionId: 'root', childSessionId: 'child' })
    inject('subagent.started', { parentSessionId: 'child', childSessionId: 'grandchild' })
    inject('session.event', { sessionId: 'grandchild', event: { type: 'noop' } })
    inject('session.event', { sessionId: 'stranger', event: { type: 'noop' } })
    inject('subagent.started', { parentSessionId: 'other-root', childSessionId: 'other-child' })
    inject('subagent.finished', { parentSessionId: 'child', childSessionId: 'grandchild' })
    // Self-loop and empty edges must not corrupt the lineage map.
    inject('subagent.started', { parentSessionId: 'loop', childSessionId: 'loop' })
    inject('subagent.started', { parentSessionId: '', childSessionId: 'x' })
    inject('subagent.finished', { childSessionId: 'root' })

    expect((await tree.next()).method).toBe('subagent.started')
    expect((await tree.next()).method).toBe('subagent.started')
    expect((await tree.next()).params.sessionId).toBe('grandchild')
    expect((await tree.next()).method).toBe('subagent.finished')
    // The foreign-root edge and stranger event were filtered; next is the root-child edge.
    expect((await tree.next()).params.childSessionId).toBe('root')
    tree.close()
    await client.close()
  })
})

describe('wire payload validation', () => {
  it('rejects a non-object session.event envelope as a protocol error', async () => {
    const harness = harnessWith({ FAKE_MALFORMED_EVENT: '1' })
    await expect(harness.run('bad-event')).rejects.toThrow(SdkProtocolError)
  })

  it('rejects an assistant/message without a content array as a protocol error', async () => {
    const harness = harnessWith({ FAKE_MALFORMED_MESSAGE: '1' })
    await expect(harness.run('bad-message')).rejects.toThrow(SdkProtocolError)
  })

  it('rejects an assistant/message without a data member as a protocol error', async () => {
    const harness = harnessWith({ FAKE_MESSAGE_WITHOUT_DATA: '1' })
    await expect(harness.run('no-data')).rejects.toThrow(SdkProtocolError)
  })

})

describe('stderr tail bound', () => {
  it('keeps only the newest lines up to the limit', async () => {
    const manyLines = Array.from({ length: 450 }, (_, i) => `line-${i}`).join('\n')
    const client = new HarnessClient(fakeLaunch({ FAKE_STDERR: manyLines, FAKE_EXIT_BEFORE_INIT: '1' }))
    cleanups.push(() => client.close())
    const failure = await client.initialize({ cwd: process.cwd(), provider: 'p', model: 'm' }).then(
      () => { throw new Error('initialize unexpectedly succeeded') },
      (error: unknown) => error,
    )
    const text = String(failure)
    // The tail is bounded to the newest 400 lines: the oldest are dropped.
    expect(text).toContain('line-449')
    expect(text).not.toContain('line-0\n')
  })
})

describe('pure helpers', () => {
  it('normalizeInput wraps strings and passes blocks through', () => {
    expect(normalizeInput('x')).toEqual([{ type: 'text', text: 'x' }])
    const blocks = [{ type: 'text' as const, text: 'y' }]
    expect(normalizeInput(blocks)).toBe(blocks)
  })

  it('finalResponse reads the last assistant message and tolerates absence', () => {
    expect(finalResponse([])).toBe('')
    expect(finalResponse([{ type: 'turn/start', seq: 0, time: 0, data: { turn: 0 } } as never])).toBe('')
    expect(finalResponse([
      { type: 'assistant/message', seq: 0, time: 0, data: { message: { content: [{ type: 'text', text: 'first' }] } } } as never,
      { type: 'assistant/message', seq: 1, time: 0, data: { message: { content: [{ type: 'text', text: 'a' }, { type: 'tool-call' }, { type: 'text', text: 'b' }] } } } as never,
    ])).toBe('ab')
  })
})
