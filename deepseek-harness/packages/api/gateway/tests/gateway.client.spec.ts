import { Context, Service } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { z } from 'zod'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {
  InvocationDescriptor,
  RemoteResult,
  TypertClientRemote,
  TypertContext,
  TypertRemoteScopeApi,
  TypertRemoteNamespace,
} from '@deepseek-ai/dsh-typert-protocol'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import type { ClientRemote } from '../src/client/index.ts'
import { apply, inject } from '../src/client/index.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Test-only forwarded Host event.
     * @param namespace - marker payload recorded by listeners.
     */
    'fixture/changed'(namespace: string): void
    /**
     * Test-only forwarded Host event nobody subscribes to.
     * @param count - marker payload never observed.
     */
    'fixture/idle'(count: number): void
    /**
     * Test-only event the Host assembly does not forward.
     * @param flag - marker payload never delivered.
     */
    'fixture/unselected'(flag: boolean): void
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteEventSelection extends Record<'fixture/changed' | 'fixture/idle', true> {}

  interface TypertContextMap {
    fixture: TypertContext<string>
  }

  interface TypertRemoteMap {
    'probe/create': (
      agentId: string,
      request: { readonly objective: string },
      signal?: AbortSignal,
    ) => Promise<RemoteResult<{ readonly ref: string }>>
    'probe/maybe': (value: string | null | undefined) => Promise<RemoteResult<string | null | undefined>>
  }

  interface TypertRemoteScopeMap {
    'fixture:probe/create': (
      request: { readonly objective: string },
      signal?: AbortSignal,
    ) => Promise<RemoteResult<{ readonly ref: string }>>
    'fixture:probe/rename': (
      request: { readonly objective: string },
    ) => Promise<RemoteResult<{ readonly renamed: boolean }>>
  }

  interface TypertRemoteNamespaceMap {
    probe: TypertRemoteNamespace<'probe'>
  }

}

type FixtureContext = Omit<Context, 'remote'> & {
  readonly remote: TypertClientRemote & TypertRemoteScopeApi<'fixture'>
}

// Compile-time contract of `$on`: the key face is the forwarding selection and
// the listener signature is the owning package's own Cordis declaration.
function remoteEventContracts(remote: ClientRemote): void {
  remote.$on('fixture/changed', (namespace) => { void namespace })
  // @ts-expect-error -- declared in Events but outside the forwarding selection.
  remote.$on('fixture/unselected', () => {})
  // @ts-expect-error -- not declared in Events at all.
  remote.$on('fixture/absent', () => {})
  // @ts-expect-error -- the listener signature comes from the event declaration.
  remote.$on('fixture/changed', (count: number) => { void count })
}
void remoteEventContracts

const idSchema = z.string().min(1)
const requestSchema = z.object({ objective: z.string().min(1) })
const createResultSchema = z.object({ ref: z.string().min(1) })
const renameResultSchema = z.object({ renamed: z.boolean() })

function directDescriptor(): InvocationDescriptor {
  return {
    id: '@fixture/probe#probe/create',
    service: 'probe',
    namespace: 'probe',
    method: 'create',
    invocation: { kind: 'direct' },
    scope: { context: 'fixture', wire: 'agentId' },
    parameters: [{
      name: 'agent',
      wire: 'agentId',
      source: 'lookup',
      lookup: 'fixture',
      codec: { mode: 'strict', typeSymbol: '@fixture#AgentId', schema: idSchema },
    }, {
      name: 'request',
      wire: 'request',
      source: 'json',
      codec: { mode: 'strict', typeSymbol: '@fixture#CreateRequest', schema: requestSchema },
    }],
    cancellation: { parameter: 'signal' },
    result: { mode: 'strict', typeSymbol: '@fixture#CreateResult', schema: createResultSchema },
  }
}

function contextDescriptor(): InvocationDescriptor {
  return {
    id: '@fixture/probe#probe/rename',
    service: 'probe',
    namespace: 'probe',
    method: 'rename',
    invocation: {
      kind: 'context',
      context: 'fixture',
      wire: 'agentId',
      codec: { mode: 'strict', typeSymbol: '@fixture#AgentId', schema: idSchema },
    },
    parameters: [{
      name: 'request',
      wire: 'request',
      source: 'json',
      codec: { mode: 'strict', typeSymbol: '@fixture#RenameRequest', schema: requestSchema },
    }],
    result: { mode: 'strict', typeSymbol: '@fixture#RenameResult', schema: renameResultSchema },
  }
}

function maybeDescriptor(): InvocationDescriptor {
  const schema = z.union([z.string(), z.null(), z.undefined()])
  return {
    id: '@fixture/probe#probe/maybe',
    service: 'probe',
    namespace: 'probe',
    method: 'maybe',
    invocation: { kind: 'direct' },
    parameters: [{
      name: 'value',
      wire: 'value',
      source: 'json',
      acceptsUndefined: true,
      codec: { mode: 'strict', typeSymbol: '@fixture#MaybeValue', schema },
    }],
    result: { mode: 'strict', typeSymbol: '@fixture#MaybeValue', schema },
  }
}

async function bench(call: ConnectionHandle['rpc']['call']): Promise<Context> {
  const { ctx } = await benchFiber(call)
  return ctx
}

async function benchFiber(
  call: ConnectionHandle['rpc']['call'],
): Promise<{ readonly ctx: Context; readonly client: Fiber }> {
  const ctx = new Context()
  await ctx.plugin(TypertRegistry)
  ctx.provide('connection', { rpc: { call } } as unknown as ConnectionHandle)
  const client = ctx.plugin({ inject, apply })
  await client
  return { ctx, client }
}

describe('Client Typert API', () => {
  it('mounts concrete direct methods, validates both boundaries, and withdraws retained handles', async () => {
    const call = vi.fn<ConnectionHandle['rpc']['call']>()
      .mockResolvedValue({ ok: true, value: { ref: 'goal-1' } })
    const ctx = await bench(call)
    const businessProbe = { owner: 'host business service' }
    const disposeBusinessProbe = ctx.provide('probe', businessProbe)
    const assembly = ctx.plugin(Object.assign(
      (scope: Context) => scope.remote.$mount({ package: '@fixture/probe', descriptors: [directDescriptor()] }),
      { inject: ['remote'] },
    ))
    await assembly
    const retained = ctx.remote.probe.create

    await expect(ctx.remote.probe.create('agent-1', { objective: 'ship' }))
      .resolves.toEqual({ ok: true, value: { ref: 'goal-1' } })
    expect(call).toHaveBeenCalledWith(
      '/api',
      'probe/create',
      { args: { agentId: 'agent-1', request: { objective: 'ship' } } },
      expect.any(AbortSignal),
    )
    const callerAbort = new AbortController()
    await expect(ctx.remote.probe.create(
      'agent-1',
      { objective: 'cancel me' },
      callerAbort.signal,
    )).resolves.toEqual({ ok: true, value: { ref: 'goal-1' } })
    const combinedSignal = call.mock.calls.at(-1)?.[3]
    expect(combinedSignal).toBeInstanceOf(AbortSignal)
    expect(combinedSignal).not.toBe(callerAbort.signal)
    const cancellation = new Error('caller cancelled')
    callerAbort.abort(cancellation)
    expect(combinedSignal?.aborted).toBe(true)
    expect(combinedSignal?.reason).toBe(cancellation)
    await expect(ctx.remote.probe.create('', { objective: 'ship' })).rejects.toThrow('rejected "agentId"')

    call.mockResolvedValueOnce({ ok: true, value: { ref: 1 } })
    await expect(ctx.remote.probe.create('agent-1', { objective: 'ship' })).resolves.toEqual({
      ok: false,
      error: {
        code: 'internal',
        message: 'client api: probe/create failed: client api: probe/create rejected "result"',
        details: {},
      },
    })

    await assembly.dispose()
    expect((ctx.remote as unknown as Record<string, unknown>).probe).toBeUndefined()
    expect(ctx.get('remote.probe')).toBeUndefined()
    expect(ctx.get('probe')).toBe(businessProbe)
    expect(ctx.typert.remotes.list()).toEqual([])
    await expect(retained?.('agent-1', { objective: 'ship' })).resolves.toEqual({
      ok: false,
      error: {
        code: 'internal',
        message: 'client api: Remote method probe/create is no longer mounted',
        details: {},
      },
    })
    disposeBusinessProbe()
  })

  it('encodes declared undefined as an omitted argument and distinguishes it from null results', async () => {
    const call = vi.fn<ConnectionHandle['rpc']['call']>()
      .mockResolvedValueOnce({ ok: true, value: undefined })
      .mockResolvedValueOnce({ ok: true, value: null })
    const ctx = await bench(call)
    const dispose = await ctx.remote.$mount({
      package: '@fixture/maybe',
      descriptors: [maybeDescriptor()],
    })

    await expect(ctx.remote.probe.maybe(undefined)).resolves.toStrictEqual({ ok: true, value: undefined })
    expect(call).toHaveBeenNthCalledWith(
      1,
      '/api',
      'probe/maybe',
      { args: {} },
      expect.any(AbortSignal),
    )
    await expect(ctx.remote.probe.maybe(null)).resolves.toStrictEqual({ ok: true, value: null })
    expect(call).toHaveBeenNthCalledWith(
      2,
      '/api',
      'probe/maybe',
      { args: { value: null } },
      expect.any(AbortSignal),
    )

    await dispose()
  })

  it('projects one direct lookup descriptor onto an Agent-scoped alias', async () => {
    const call = vi.fn<ConnectionHandle['rpc']['call']>()
      .mockResolvedValue({ ok: true, value: { ref: 'goal-2' } })
    const ctx = await bench(call)
    const agentCtx = ctx.extend({ fixtureId: 'agent-2' }) as FixtureContext
    ctx.typert.contexts.registerClient('fixture', {
      identity: candidate => (candidate as Context & { fixtureId?: string }).fixtureId,
    })
    const assembly = ctx.plugin(Object.assign(
      (scope: Context) => scope.remote.$mount({ package: '@fixture/probe', descriptors: [directDescriptor()] }),
      { inject: ['remote'] },
    ))
    await assembly

    await expect(agentCtx.remote.probe.create({ objective: 'ship scoped' }))
      .resolves.toEqual({ ok: true, value: { ref: 'goal-2' } })
    expect(call).toHaveBeenCalledWith(
      '/api',
      'probe/create',
      { args: { agentId: 'agent-2', request: { objective: 'ship scoped' } } },
      expect.any(AbortSignal),
    )
    await expect((ctx as FixtureContext).remote.probe.create({ objective: 'wrong scope' }))
      .rejects.toThrow('expected 2 business argument(s)')

    await assembly.dispose()
    expect((ctx.remote as unknown as Record<string, unknown>).probe).toBeUndefined()
    expect(ctx.get('remote.probe')).toBeUndefined()
  })

  it('uses the caller Context identity for scoped namespace methods', async () => {
    const call = vi.fn<ConnectionHandle['rpc']['call']>()
      .mockResolvedValue({ ok: true, value: { renamed: true } })
    const ctx = await bench(call)
    const agentCtx = ctx.extend({ fixtureId: 'agent-2' }) as FixtureContext
    ctx.typert.contexts.registerClient('fixture', {
      identity: candidate => (candidate as Context & { fixtureId?: string }).fixtureId,
    })
    const assembly = ctx.plugin(Object.assign(
      (scope: Context) => scope.remote.$mount({ package: '@fixture/probe', descriptors: [contextDescriptor()] }),
      { inject: ['remote'] },
    ))
    await assembly

    await expect(agentCtx.remote.probe.rename({ objective: 'land' }))
      .resolves.toEqual({ ok: true, value: { renamed: true } })
    expect(call).toHaveBeenCalledWith(
      '/api',
      'probe/rename',
      { args: { agentId: 'agent-2', request: { objective: 'land' } } },
      expect.any(AbortSignal),
    )
    await expect((ctx as FixtureContext).remote.probe.rename({ objective: 'land' }))
      .rejects.toThrow('requires a "fixture" Context')

    await assembly.dispose()
    expect(ctx.get('remote.probe')).toBeUndefined()
  })

  it('rejects weak descriptors and namespace collisions before registration', async () => {
    const ctx = await bench(vi.fn<ConnectionHandle['rpc']['call']>())
    const weak: InvocationDescriptor = {
      ...directDescriptor(),
      result: { mode: 'src-json' },
    }

    await expect(ctx.remote.$mount({ package: '@fixture/weak', descriptors: [weak] }))
      .rejects.toThrow('has no strict codec')
    await expect(ctx.remote.$mount({
      package: '@fixture/conflict',
      descriptors: [{ ...directDescriptor(), namespace: '$mount' }],
    })).rejects.toThrow('conflicts with the Remote service')
    expect(ctx.typert.remotes.list()).toEqual([])
  })

  it('rejects duplicate, live, scoped-service, and Context namespace collisions', async () => {
    const call = vi.fn<ConnectionHandle['rpc']['call']>()
      .mockResolvedValue({ ok: true, value: { renamed: true } })
    const ctx = await bench(call)
    const agentCtx = ctx.extend({ fixtureId: 'agent-remounted' }) as FixtureContext
    ctx.typert.contexts.registerClient('fixture', {
      identity: candidate => (candidate as Context & { fixtureId?: string }).fixtureId,
    })
    const direct = directDescriptor()
    const context = contextDescriptor()

    await expect(ctx.remote.$mount({
      package: '@fixture/direct-duplicates',
      descriptors: [direct, { ...direct, id: '@fixture/probe#probe/create-again' }],
    })).rejects.toThrow('repeats direct method')
    await expect(ctx.remote.$mount({
      package: '@fixture/scoped-duplicates',
      descriptors: [context, { ...context, id: '@fixture/probe#probe/rename-again' }],
    })).rejects.toThrow('repeats scoped method')

    const disposeDirect = await ctx.remote.$mount({ package: '@fixture/direct-live', descriptors: [direct] })
    await expect(ctx.remote.$mount({
      package: '@fixture/direct-conflict', descriptors: [{ ...direct, id: '@fixture/other#probe/create' }],
    })).rejects.toThrow('direct method probe/create is already mounted')
    await disposeDirect()

    const disposeScoped = await ctx.remote.$mount({ package: '@fixture/scoped-live', descriptors: [context] })
    await expect(ctx.remote.$mount({
      package: '@fixture/scoped-conflict', descriptors: [{ ...context, id: '@fixture/other#probe/rename' }],
    })).rejects.toThrow('scoped method probe/rename is already mounted')
    await expect(ctx.remote.$mount({
      package: '@fixture/service-method-conflict',
      descriptors: [{ ...context, id: '@fixture/probe#probe/remove', method: 'remove' }],
    })).rejects.toThrow('conflicts with its namespace service')
    const scopedService = ctx.get('remote.probe') as unknown as object
    Object.defineProperty(scopedService, 'custom', { configurable: true, value: () => undefined })
    await expect(ctx.remote.$mount({
      package: '@fixture/service-own-property-conflict',
      descriptors: [{ ...direct, id: '@fixture/probe#probe/custom', method: 'custom' }],
    })).rejects.toThrow('conflicts with its namespace service')
    Reflect.deleteProperty(scopedService, 'custom')
    await disposeScoped()

    const disposeRemoteTypert = ctx.reflect.provide('remote.typert', { owner: 'fixture' })
    await expect(ctx.remote.$mount({
      package: '@fixture/context-property-conflict',
      descriptors: [{ ...context, namespace: 'typert' }],
    })).rejects.toThrow('conflicts with an existing Remote namespace')
    await disposeRemoteTypert()

    const disposeMultipleScoped = await ctx.remote.$mount({
      package: '@fixture/multiple-scoped',
      descriptors: [directDescriptor(), contextDescriptor()],
    })
    await expect(agentCtx.remote.probe.rename({ objective: 'remounted' }))
      .resolves.toEqual({ ok: true, value: { renamed: true } })
    expect(call).toHaveBeenLastCalledWith(
      '/api',
      'probe/rename',
      { args: { agentId: 'agent-remounted', request: { objective: 'remounted' } } },
      expect.any(AbortSignal),
    )
    await disposeMultipleScoped()
  })

  it('rolls back earlier descriptors when a later descriptor fails to install', async () => {
    const ctx = await bench(vi.fn<ConnectionHandle['rpc']['call']>())
    const { scope: _scope, ...first } = directDescriptor()
    const second: InvocationDescriptor = {
      ...first,
      id: '@fixture/probe#probe/archive',
      method: 'archive',
    }
    const defineProperty = Object.defineProperty
    const spy = vi.spyOn(Object, 'defineProperty').mockImplementation((target, key, attributes) => {
      if (key === 'archive') throw new Error('fixture later-descriptor failure')
      return defineProperty(target, key, attributes)
    })
    try {
      await expect(ctx.remote.$mount({ package: '@fixture/failing-batch', descriptors: [first, second] }))
        .rejects.toThrow('fixture later-descriptor failure')
    } finally {
      spy.mockRestore()
    }

    expect((ctx.remote as unknown as Record<string, unknown>).probe).toBeUndefined()
    await vi.waitFor(() => { expect(ctx.typert.remotes.list()).toEqual([]) })
    const retry = await ctx.remote.$mount({ package: '@fixture/retry-batch', descriptors: [first, second] })
    expect(ctx.remote.probe.create).toBeTypeOf('function')
    expect((ctx.remote.probe as unknown as Record<string, unknown>).archive).toBeTypeOf('function')
    await retry()
  })

  it('rolls back a direct projection when its scoped projection fails to install', async () => {
    const ctx = await bench(vi.fn<ConnectionHandle['rpc']['call']>())
    const disposeContext = await ctx.remote.$mount({
      package: '@fixture/context-anchor',
      descriptors: [contextDescriptor()],
    })
    const namespace = ctx.get('remote.probe') as unknown as {
      installScoped: (...args: unknown[]) => void
      readonly create?: unknown
    }
    const installScoped = vi.spyOn(namespace, 'installScoped').mockImplementation(() => {
      throw new Error('fixture scoped projection failure')
    })
    try {
      await expect(ctx.remote.$mount({
        package: '@fixture/direct-projection-failure',
        descriptors: [directDescriptor()],
      })).rejects.toThrow('fixture scoped projection failure')
    } finally {
      installScoped.mockRestore()
    }

    expect(namespace.create).toBeUndefined()
    await disposeContext()
  })

  it('rejects weak parameter and Context codecs plus malformed scope projections', async () => {
    const ctx = await bench(vi.fn<ConnectionHandle['rpc']['call']>())
    const direct = directDescriptor()
    const context = contextDescriptor()
    await expect(ctx.remote.$mount({
      package: '@fixture/weak-parameter',
      descriptors: [{
        ...direct,
        parameters: direct.parameters.map((parameter, index) => index === 0
          ? { ...parameter, codec: { mode: 'src-json' } }
          : parameter),
      }],
    })).rejects.toThrow('has no strict codec')
    await expect(ctx.remote.$mount({
      package: '@fixture/weak-context',
      descriptors: [{
        ...context,
        invocation: { ...context.invocation, codec: { mode: 'src-json' } },
      } as InvocationDescriptor],
    })).rejects.toThrow('has no strict codec')
    await expect(ctx.remote.$mount({
      package: '@fixture/malformed-scope',
      descriptors: [{ ...direct, scope: { context: 'fixture', wire: 'missingId' } }],
    })).rejects.toThrow('scope must select its only lookup parameter')
    await expect(ctx.remote.$mount({
      package: '@fixture/ambiguous-scope',
      descriptors: [{
        ...direct,
        parameters: [...direct.parameters, {
          name: 'other', wire: 'otherId', source: 'lookup', lookup: 'fixture',
          codec: { mode: 'strict', typeSymbol: '@fixture#AgentId', schema: idSchema },
        }],
      }],
    })).rejects.toThrow('scope must select its only lookup parameter')
  })

  it('validates invocation arity, required binders, live Connection, and mutable descriptor codecs', async () => {
    const call = vi.fn<ConnectionHandle['rpc']['call']>()
      .mockResolvedValue({ ok: true, value: { ref: 'goal-1' } })
    const ctx = await bench(call)
    const descriptor = directDescriptor()
    const dispose = await ctx.remote.$mount({
      package: '@fixture/probe',
      descriptors: [descriptor, contextDescriptor()],
    })
    const create = ctx.remote.probe.create as unknown as (...args: unknown[]) => Promise<unknown>
    const probe = (ctx as FixtureContext).remote.probe
    const rename = probe.rename as unknown as (...args: unknown[]) => Promise<unknown>

    await expect(create('agent-1')).rejects.toThrow('expected 2 business argument(s) plus an optional AbortSignal, got 1')
    await expect(create('agent-1', { objective: 'ship' }, undefined, 'extra'))
      .rejects.toThrow('got 4')
    await expect(rename.call(probe)).rejects.toThrow('expected 1 argument(s), got 0')
    await expect((ctx as FixtureContext).remote.probe.create({ objective: 'ship' }))
      .rejects.toThrow('expected 2 business argument(s)')
    await expect((ctx as FixtureContext).remote.probe.rename({ objective: 'ship' }))
      .rejects.toThrow('no Client Context binder')

    ;(descriptor.parameters[0] as { codec: { mode: string } }).codec.mode = 'src-json'
    await expect(ctx.remote.probe.create('agent-1', { objective: 'ship' })).rejects.toThrow('has no strict codec')
    ;(descriptor.parameters[0] as { codec: { mode: string } }).codec.mode = 'strict'

    ctx.set('connection', undefined)
    await expect(ctx.remote.probe.create('agent-1', { objective: 'ship' })).rejects.toThrow('no active Connection')
    await dispose()
  })

  it('withdraws a pending invocation and preserves a direct namespace until its last method leaves', async () => {
    let resolveCall!: (result: Awaited<ReturnType<ConnectionHandle['rpc']['call']>>) => void
    const pending = new Promise<Awaited<ReturnType<ConnectionHandle['rpc']['call']>>>((resolve) => {
      resolveCall = resolve
    })
    const call = vi.fn<ConnectionHandle['rpc']['call']>().mockReturnValue(pending)
    const ctx = await bench(call)
    const { scope: _scope, ...first } = directDescriptor()
    const second: InvocationDescriptor = {
      ...first,
      id: '@fixture/probe#probe/archive',
      method: 'archive',
    }
    const dispose = await ctx.remote.$mount({ package: '@fixture/probe', descriptors: [first, second] })
    const invocation = ctx.remote.probe.create('agent-1', { objective: 'ship' })
    await vi.waitFor(() => { expect(call).toHaveBeenCalledTimes(1) })
    await dispose()
    resolveCall({ ok: true, value: { ref: 'goal-1' } })

    await expect(invocation).resolves.toEqual({
      ok: false,
      error: {
        code: 'internal',
        message: 'client api: Remote method probe/create is no longer mounted',
        details: {},
      },
    })
    expect((ctx.remote as unknown as Record<string, unknown>).probe).toBeUndefined()
  })

  it('fails a method obtained from a withdrawn namespace getter', async () => {
    const ctx = await bench(vi.fn<ConnectionHandle['rpc']['call']>())
    const dispose = await ctx.remote.$mount({ package: '@fixture/probe', descriptors: [directDescriptor()] })
    const namespace = ctx.get('remote.probe') as unknown as object
    const getWithdrawn = Object.getOwnPropertyDescriptor(namespace, 'create')?.get?.bind(namespace)

    await dispose()

    expect(getWithdrawn).toBeTypeOf('function')
    const withdrawn = getWithdrawn?.() as (...args: unknown[]) => Promise<unknown>
    expect(() => withdrawn('agent-1', { objective: 'ship' }))
      .toThrow('Remote method is no longer mounted')
  })

  it('preserves a __proto__ wire parameter as an own named argument', async () => {
    const call = vi.fn<ConnectionHandle['rpc']['call']>()
      .mockResolvedValue({ ok: true, value: { ref: 'goal-1' } })
    const ctx = await bench(call)
    const { scope: _scope, ...base } = directDescriptor()
    const descriptor: InvocationDescriptor = {
      ...base,
      id: '@fixture/probe#probe/prototype',
      method: 'prototype',
      parameters: [{
        name: 'value',
        wire: '__proto__',
        source: 'json',
        codec: { mode: 'strict', typeSymbol: '@fixture#PrototypeValue', schema: z.string() },
      }],
    }
    const dispose = await ctx.remote.$mount({ package: '@fixture/prototype', descriptors: [descriptor] })

    const method = (ctx.remote.probe as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>).prototype
    await expect(method?.('wire-value')).resolves.toEqual({ ok: true, value: { ref: 'goal-1' } })
    const payload = call.mock.calls[0]?.[2] as { readonly args: Record<string, unknown> }
    expect(Object.getPrototypeOf(payload.args)).toBeNull()
    expect(Object.hasOwn(payload.args, '__proto__')).toBe(true)
    expect(payload.args.__proto__).toBe('wire-value')
    await dispose()
  })

  it('rolls back Remote registration when namespace Service startup fails', async () => {
    const ctx = await bench(vi.fn<ConnectionHandle['rpc']['call']>())
    const defineProperty = Object.defineProperty
    const spy = vi.spyOn(Object, 'defineProperty').mockImplementation((target, key, attributes) => {
      if (key === Service.tracker) throw new Error('fixture namespace startup failure')
      return defineProperty(target, key, attributes)
    })
    try {
      await expect(ctx.remote.$mount({ package: '@fixture/probe', descriptors: [directDescriptor()] }))
        .rejects.toThrow('fixture namespace startup failure')
      await vi.waitFor(() => { expect(ctx.typert.remotes.list()).toEqual([]) })
    } finally {
      spy.mockRestore()
    }

    const retry = await ctx.remote.$mount({ package: '@fixture/probe-retry', descriptors: [directDescriptor()] })
    expect(ctx.remote.probe.create).toBeTypeOf('function')
    await retry()
  })

  it('withdraws a fresh direct namespace when its first method fails to install', async () => {
    const ctx = await bench(vi.fn<ConnectionHandle['rpc']['call']>())
    const defineProperty = Object.defineProperty
    const spy = vi.spyOn(Object, 'defineProperty').mockImplementation((target, key, attributes) => {
      if (key === 'create') throw new Error('fixture direct method installation failure')
      return defineProperty(target, key, attributes)
    })
    try {
      await expect(ctx.remote.$mount({
        package: '@fixture/direct-method-failure',
        descriptors: [directDescriptor()],
      })).rejects.toThrow('fixture direct method installation failure')
    } finally {
      spy.mockRestore()
    }

    expect((ctx.remote as unknown as Record<string, unknown>).probe).toBeUndefined()
    await vi.waitFor(() => { expect(ctx.typert.remotes.list()).toEqual([]) })
    const retry = await ctx.remote.$mount({
      package: '@fixture/direct-method-retry',
      descriptors: [directDescriptor()],
    })
    expect(ctx.remote.probe.create).toBeTypeOf('function')
    await retry()
  })

  it('withdraws a fresh scoped Service when its first method fails to install', async () => {
    const ctx = await bench(vi.fn<ConnectionHandle['rpc']['call']>())
    const defineProperty = Object.defineProperty
    const spy = vi.spyOn(Object, 'defineProperty').mockImplementation((target, key, attributes) => {
      if (key === 'rename') throw new Error('fixture scoped installation failure')
      return defineProperty(target, key, attributes)
    })
    try {
      await expect(ctx.remote.$mount({ package: '@fixture/scoped-failure', descriptors: [contextDescriptor()] }))
        .rejects.toThrow('fixture scoped installation failure')
    } finally {
      spy.mockRestore()
    }

    expect(ctx.get('remote.probe')).toBeUndefined()
    await vi.waitFor(() => { expect(ctx.typert.remotes.list()).toEqual([]) })
    const retry = await ctx.remote.$mount({ package: '@fixture/scoped-retry', descriptors: [contextDescriptor()] })
    expect((ctx.get('remote.probe') as unknown as Record<string, unknown>).rename).toBeTypeOf('function')
    await retry()
  })

  it('unregisters an empty scoped namespace so another provider can claim its name', async () => {
    const ctx = await bench(vi.fn<ConnectionHandle['rpc']['call']>())
    const dispose = await ctx.remote.$mount({ package: '@fixture/scoped', descriptors: [contextDescriptor()] })
    expect(ctx.get('remote.probe')).toBeDefined()

    await dispose()

    expect(ctx.get('remote.probe')).toBeUndefined()
    const replacement = { owner: 'replacement' }
    const disposeReplacement = ctx.reflect.provide('remote.probe', replacement)
    expect(ctx.get('remote.probe')).toBe(replacement)
    await disposeReplacement()
  })

  it('delivers an RPC failure in the error branch with the Host error verbatim', async () => {
    const rpcError = { code: 'internal' as const, message: 'host failed', details: {} }
    const ctx = await bench(vi.fn<ConnectionHandle['rpc']['call']>().mockResolvedValue({ ok: false, error: rpcError }))
    await ctx.remote.$mount({ package: '@fixture/probe', descriptors: [directDescriptor()] })

    const outcome = await ctx.remote.probe.create('agent-1', { objective: 'ship' })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error('expected the Client API invocation to report a failure')
    expect(outcome.error).toBe(rpcError)
  })

  it('folds a transport throw into the error branch', async () => {
    const ctx = await bench(vi.fn<ConnectionHandle['rpc']['call']>()
      .mockRejectedValue(new Error('carrier offline')))
    await ctx.remote.$mount({ package: '@fixture/probe', descriptors: [directDescriptor()] })

    await expect(ctx.remote.probe.create('agent-1', { objective: 'ship' })).resolves.toEqual({
      ok: false,
      error: {
        code: 'internal',
        message: 'client api: probe/create failed: carrier offline',
        details: {},
      },
    })
  })

  it('folds a carrier throw that is not an Error into the error branch', async () => {
    const ctx = await bench(vi.fn<ConnectionHandle['rpc']['call']>()
      .mockRejectedValue('carrier exploded'))
    await ctx.remote.$mount({ package: '@fixture/probe', descriptors: [directDescriptor()] })

    await expect(ctx.remote.probe.create('agent-1', { objective: 'ship' })).resolves.toEqual({
      ok: false,
      error: {
        code: 'internal',
        message: 'client api: probe/create failed: carrier exploded',
        details: {},
      },
    })
  })

  it('owns each $on subscription in the calling fiber', async () => {
    const { ctx, client } = await benchFiber(vi.fn<ConnectionHandle['rpc']['call']>())
    const seen: string[] = []
    const subscriber = ctx.plugin(Object.assign(
      (scope: Context) => { scope.remote.$on('fixture/changed', (namespace) => { seen.push(namespace) }) },
      { inject: ['remote'] },
    ))
    await subscriber

    ctx.remote.$dispatch('fixture/changed', ['settings'])
    expect(seen).toEqual(['settings'])

    await subscriber.dispose()
    ctx.remote.$dispatch('fixture/changed', ['after fiber disposal'])
    expect(seen).toEqual(['settings'])

    await client.dispose()
    expect(ctx.get('remote')).toBeUndefined()
  })

  it('isolates a throwing listener from the rest of the same event', async () => {
    const ctx = await bench(vi.fn<ConnectionHandle['rpc']['call']>())
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const seen: string[] = []
    const disposeFirst = ctx.remote.$on('fixture/changed', () => {
      throw new Error('fixture listener failure')
    })
    ctx.remote.$on('fixture/changed', (namespace) => { seen.push(namespace) })
    try {
      ctx.remote.$dispatch('fixture/changed', ['credentials'])

      expect(seen).toEqual(['credentials'])
      expect(consoleError).toHaveBeenCalledWith(
        'client api: Remote event "fixture/changed" listener threw:',
        expect.any(Error),
      )
      disposeFirst()
      ctx.remote.$dispatch('fixture/changed', ['commands'])
      expect(seen).toEqual(['credentials', 'commands'])
      expect(consoleError).toHaveBeenCalledTimes(1)
    } finally {
      consoleError.mockRestore()
    }
  })

  it('contains an async listener whose promise rejects', async () => {
    const ctx = await bench(vi.fn<ConnectionHandle['rpc']['call']>())
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const seen: string[] = []
    // The declared return is void, so nobody awaits an async listener: the
    // rejection has to be contained here or it escapes as an unhandled one.
    ctx.remote.$on('fixture/changed', () => Promise.reject(new Error('fixture async failure'))) // oxlint-disable-line typescript/no-misused-promises
    ctx.remote.$on('fixture/changed', (namespace) => { seen.push(namespace) })
    try {
      ctx.remote.$dispatch('fixture/changed', ['credentials'])
      await Promise.resolve()
      await Promise.resolve()

      expect(seen).toEqual(['credentials'])
      expect(consoleError).toHaveBeenCalledWith(
        'client api: Remote event "fixture/changed" listener threw:',
        expect.any(Error),
      )
    } finally {
      consoleError.mockRestore()
    }
  })

  it('retires only its own registration when one listener subscribes twice', async () => {
    const ctx = await bench(vi.fn<ConnectionHandle['rpc']['call']>())
    const seen: string[] = []
    // One function object, two registrations. A table keyed by listener identity
    // stores it once, so the first frame would reach it once instead of twice
    // and either disposer would silence both.
    const listener = (namespace: string): void => { seen.push(namespace) }
    const disposeFirst = ctx.remote.$on('fixture/changed', listener)
    ctx.remote.$on('fixture/changed', listener)

    ctx.remote.$dispatch('fixture/changed', ['both'])
    expect(seen).toEqual(['both', 'both'])

    // The surviving registration keeps receiving after its twin retires.
    disposeFirst()
    ctx.remote.$dispatch('fixture/changed', ['survivor'])
    expect(seen).toEqual(['both', 'both', 'survivor'])

    // Disposing twice is inert: the record is already gone, so the second call
    // must not splice the surviving twin out from under its own owner.
    disposeFirst()
    ctx.remote.$dispatch('fixture/changed', ['still here'])
    expect(seen).toEqual(['both', 'both', 'survivor', 'still here'])
  })

  it('separates the consumer verb from the carrier handoff', () => {
    expectTypeOf<ClientRemote>().toHaveProperty('$on')
    // The carrier owning the frame sink calls this; a consumer subscribes instead.
    expectTypeOf<ClientRemote>().toHaveProperty('$dispatch')
  })

  it('drops a forwarded event nobody subscribes to', async () => {
    const ctx = await bench(vi.fn<ConnectionHandle['rpc']['call']>())
    const seen: string[] = []
    ctx.remote.$on('fixture/changed', (namespace) => { seen.push(namespace) })

    ctx.remote.$dispatch('fixture/idle', [1])

    expect(seen).toEqual([])
  })
})
