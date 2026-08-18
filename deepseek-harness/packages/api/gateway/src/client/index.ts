/**
 * Client projection of generated Typert Remote descriptors. Contributions
 * install traced `remote.<namespace>` services; no JavaScript Proxy
 * participates in method lookup, invocation, or type exposure.
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context, Events } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {
  InvocationDescriptor,
  TypertClientRemote,
  RemoteResult,
  TypertCodec,
  TypertDisposer,
  TypertRemoteContribution,
  TypertRemoteEvent,
} from '@deepseek-ai/dsh-typert-protocol'

interface MountToken {
  active: boolean
  readonly abort: AbortController
}

interface ScopedProjection {
  readonly context: string
  readonly wire: string
  readonly codec: TypertCodec
  readonly parameterIndex?: number
}

interface DirectMethod {
  readonly descriptor: InvocationDescriptor
  readonly token: MountToken
}

interface ScopedMethod extends DirectMethod {
  readonly projection: ScopedProjection
}

interface RemoteMethodRecord {
  direct?: DirectMethod
  scoped?: ScopedMethod
}

interface BoundContextIdentity {
  readonly value: unknown
}

interface RemoteNamespaceHandle {
  readonly service: RemoteNamespaceService
  readonly dispose: TypertDisposer
}

/** Typed Remote service augmented by generated direct namespaces. */
export type ClientRemote = TypertClientRemote

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Generated Remote namespaces selected by the Client assembly. */
    remote: ClientRemote
  }
}

/** Required Client services: the Typert registry and the existing Connection carrier. */
export const inject = ['typert', 'connection']

/**
 * Install the typed Client Remote service.
 * @param ctx - Client Cordis root.
 */
export function apply(ctx: Context): void {
  new ClientRemoteService(ctx)
}

/** One subscribed listener after `$on` erased its per-event argument list. */
type RemoteEventListener = (...args: never[]) => void

/**
 * One subscription, identified by the registration rather than by its listener:
 * two fibers may subscribe the same function object to the same event, and each
 * disposer must retire only its own registration.
 */
interface RemoteEventSubscription {
  readonly listener: RemoteEventListener
}

class ClientRemoteService extends Service implements TypertClientRemote {
  private readonly ownerCtx: Context
  private readonly namespaces = new Map<string, RemoteNamespaceHandle>()
  private readonly subscriptions = new Map<string, RemoteEventSubscription[]>()
  private mutations = Promise.resolve()

  constructor(ctx: Context) {
    super(ctx, 'remote')
    this.ownerCtx = ctx
    ctx.effect(() => () => { this.subscriptions.clear() }, 'api-gateway.client.subscriptions')
  }

  async $mount(contribution: TypertRemoteContribution): ReturnType<TypertClientRemote['$mount']> {
    const callerCtx = this.ctx
    const owned = callerCtx.effect(async () => {
      const dispose = await this.enqueue(() => this.mountContribution(callerCtx, contribution))
      return () => this.enqueue(dispose)
    }, `api-gateway.client.$mount(${JSON.stringify(contribution.package)})`)
    await owned
    return async () => { await owned() }
  }

  $on<Event extends TypertRemoteEvent>(
    event: Event,
    listener: Events[Event],
  ): ReturnType<TypertClientRemote['$on']> {
    // The table is keyed by the runtime event name, so the argument list this
    // signature pins per event cannot survive in it; `$deliver` restores it
    // from the frame the Host emitted for that same name.
    const subscription: RemoteEventSubscription = { listener }
    const owned = this.ctx.effect(() => {
      const listeners = this.listeners(event)
      listeners.push(subscription)
      return () => {
        const at = listeners.indexOf(subscription)
        /* v8 ignore next -- listener */
        if (at >= 0) listeners.splice(at, 1)
      }
    }, `api-gateway.client.$on(${JSON.stringify(event)})`)
    return () => { void owned() }
  }

  /**
   * Deliver one forwarded event in registration order, isolating a listener
   * that fails either synchronously or by rejecting a returned promise; see
   * {@link TypertClientRemote.$dispatch} for the caller contract.
   */
  $dispatch(event: string, args: readonly unknown[]): void {
    const listeners = this.subscriptions.get(event)
    if (listeners === undefined) return
    // Snapshot: a listener may subscribe or dispose during delivery, and this
    // round's recipients are the ones registered when the frame arrived.
    for (const { listener } of [...listeners]) {
      const report = (error: unknown): void => {
        console.error(`client api: Remote event ${JSON.stringify(event)} listener threw:`, error)
      }
      try {
        /* oxlint-disable-next-line typescript/no-confusing-void-expression --
         * The declared return is void, so nobody awaits an async listener; the
         * runtime value is still a promise, and reading it is the only way to
         * keep its rejection inside this containment instead of surfacing as an
         * unhandled one. */
        const settled: unknown = listener(...args as never[])
        if (settled instanceof Promise) settled.catch(report)
      } catch (error) {
        report(error)
      }
    }
  }

  /** Subscriptions for one event name; empty arrays are retained, bounded by the Host's selection. */
  private listeners(event: string): RemoteEventSubscription[] {
    let listeners = this.subscriptions.get(event)
    if (listeners === undefined) {
      listeners = []
      this.subscriptions.set(event, listeners)
    }
    return listeners
  }

  private enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = this.mutations.then(operation, operation)
    this.mutations = result.then(() => undefined, () => undefined)
    return result
  }

  private async mountContribution(
    callerCtx: Context,
    contribution: TypertRemoteContribution,
  ): Promise<TypertDisposer> {
    this.validateContribution(contribution)
    const disposeRemote = callerCtx.typert.remotes.register(contribution)
    const installed: TypertDisposer[] = []
    try {
      for (const descriptor of contribution.descriptors) installed.push(await this.install(descriptor))
    } catch (error) {
      for (const dispose of installed.reverse()) await dispose()
      await disposeRemote()
      throw error
    }
    return async () => {
      for (const dispose of installed.reverse()) await dispose()
      await disposeRemote()
    }
  }

  private validateContribution(contribution: TypertRemoteContribution): void {
    const direct = new Map<string, Set<string>>()
    const scoped = new Map<string, Set<string>>()
    const add = (
      table: Map<string, Set<string>>,
      descriptor: InvocationDescriptor,
      kind: 'direct' | 'scoped',
    ): void => {
      const methods = table.get(descriptor.namespace) ?? new Set<string>()
      if (methods.has(descriptor.method)) {
        throw new Error(`client api: contribution repeats ${kind} method ${endpointOf(descriptor)}`)
      }
      methods.add(descriptor.method)
      table.set(descriptor.namespace, methods)
      const namespace = this.namespaces.get(descriptor.namespace)?.service
      if (namespace?.has(kind, descriptor.method) === true) {
        throw new Error(`client api: ${kind} method ${endpointOf(descriptor)} is already mounted`)
      }
    }
    for (const descriptor of contribution.descriptors) {
      requireStrictDescriptor(descriptor)
      if (descriptor.invocation.kind === 'direct') add(direct, descriptor, 'direct')
      if (scopedProjection(descriptor) !== undefined) add(scoped, descriptor, 'scoped')
    }
    const namespaces = new Set([...direct.keys(), ...scoped.keys()])
    for (const namespace of namespaces) {
      const service = this.namespaces.get(namespace)?.service
      if (service === undefined) {
        if (namespace in this) {
          throw new Error(`client api: namespace ${JSON.stringify(namespace)} conflicts with the Remote service`)
        }
        const serviceKey = remoteServiceKey(namespace)
        const property = this.ownerCtx.reflect.props[serviceKey]
        if (property?.type === 'accessor' || this.ownerCtx.get(serviceKey) !== undefined) {
          throw new Error(`client api: namespace ${JSON.stringify(namespace)} conflicts with an existing Remote namespace`)
        }
      }
      for (const method of new Set([...(direct.get(namespace) ?? []), ...(scoped.get(namespace) ?? [])])) {
        if (service === undefined) RemoteNamespaceService.assertMethodAvailable(namespace, method)
        else service.assertMethodAvailable(method)
      }
    }
  }

  private async install(descriptor: InvocationDescriptor): Promise<TypertDisposer> {
    const token: MountToken = { active: true, abort: new AbortController() }
    const installed: TypertDisposer[] = []
    try {
      if (descriptor.invocation.kind === 'direct') {
        installed.push(await this.installDirect(descriptor, token))
      }
      const projection = scopedProjection(descriptor)
      if (projection !== undefined) installed.push(await this.installScoped(descriptor, projection, token))
    } catch (error) {
      token.active = false
      token.abort.abort()
      for (const dispose of installed.reverse()) await dispose()
      throw error
    }
    return async () => {
      /* v8 ignore next -- Cordis effect disposers are idempotent and invoke this cleanup at most once. */
      if (!token.active) return
      token.active = false
      token.abort.abort()
      for (const dispose of installed.reverse()) await dispose()
    }
  }

  private async installDirect(descriptor: InvocationDescriptor, token: MountToken): Promise<TypertDisposer> {
    const namespace = await this.namespace(descriptor.namespace)
    try {
      namespace.service.installDirect(descriptor, token)
    } catch (error) {
      await this.disposeNamespace(descriptor.namespace, namespace)
      throw error
    }
    return async () => {
      namespace.service.remove('direct', descriptor.method, token)
      await this.disposeNamespace(descriptor.namespace, namespace)
    }
  }

  private async installScoped(
    descriptor: InvocationDescriptor,
    projection: ScopedProjection,
    token: MountToken,
  ): Promise<TypertDisposer> {
    const namespace = await this.namespace(descriptor.namespace)
    try {
      namespace.service.installScoped(descriptor, projection, token)
    } catch (error) {
      await this.disposeNamespace(descriptor.namespace, namespace)
      throw error
    }
    return async () => {
      namespace.service.remove('scoped', descriptor.method, token)
      await this.disposeNamespace(descriptor.namespace, namespace)
    }
  }

  private async namespace(name: string): Promise<RemoteNamespaceHandle> {
    let namespace = this.namespaces.get(name)
    if (namespace !== undefined) return namespace
    let service: RemoteNamespaceService | undefined
    const fiber = this.ownerCtx.plugin({
      name: remoteServiceKey(name),
      apply: (ctx: Context) => {
        service = new RemoteNamespaceService(
          ctx,
          name,
          (direct, scoped, caller, args) => this.invokeMethod(direct, scoped, caller, args),
        )
      },
    })
    try {
      await fiber
    } catch (error) {
      await fiber.dispose()
      throw error
    }
    /* v8 ignore next -- a settled namespace fiber synchronously constructs its Service. */
    if (service === undefined) throw new Error(`client api: namespace ${JSON.stringify(name)} did not start`)
    namespace = { service, dispose: fiber.dispose }
    this.namespaces.set(name, namespace)
    return namespace
  }

  private async disposeNamespace(name: string, namespace: RemoteNamespaceHandle): Promise<void> {
    if (!namespace.service.empty || this.namespaces.get(name) !== namespace) return
    this.namespaces.delete(name)
    await namespace.dispose()
  }

  private invokeMethod(
    direct: DirectMethod | undefined,
    scoped: ScopedMethod | undefined,
    callerCtx: Context,
    values: readonly unknown[],
  ): Promise<RemoteResult<unknown>> {
    if (scoped !== undefined) {
      const binder = this.ownerCtx.typert.contexts.getClient(scoped.projection.context)
      const identity = binder?.identity(callerCtx)
      if (identity !== undefined) {
        return this.invoke(
          scoped.descriptor,
          scoped.projection,
          scoped.token,
          callerCtx,
          values,
          { value: identity },
        )
      }
    }
    if (direct !== undefined) {
      return this.invoke(direct.descriptor, undefined, direct.token, callerCtx, values)
    }
    if (scoped !== undefined) {
      return this.invoke(scoped.descriptor, scoped.projection, scoped.token, callerCtx, values)
    }
    throw new Error('client api: Remote method is no longer mounted')
  }

  private async invoke(
    descriptor: InvocationDescriptor,
    projection: ScopedProjection | undefined,
    token: MountToken,
    callerCtx: Context,
    values: readonly unknown[],
    boundIdentity?: BoundContextIdentity,
  ): Promise<RemoteResult<unknown>> {
    const endpoint = endpointOf(descriptor)
    if (!token.active) return withdrawn(endpoint)
    const expected = descriptor.parameters.length - (projection?.parameterIndex === undefined ? 0 : 1)
    const hasCallerSignal = descriptor.cancellation !== undefined && values.length === expected + 1
    if (values.length !== expected && !hasCallerSignal) {
      const contract = descriptor.cancellation === undefined
        ? `${String(expected)} argument(s)`
        : `${String(expected)} business argument(s) plus an optional AbortSignal`
      throw new Error(
        `client api: ${endpoint} expected ${contract}, got ${String(values.length)}`,
      )
    }
    const args = Object.create(null) as Record<string, unknown>
    if (projection !== undefined) {
      const binder = boundIdentity === undefined
        ? this.ownerCtx.typert.contexts.getClient(projection.context)
        : undefined
      if (boundIdentity === undefined && binder === undefined) {
        throw new Error(`client api: ${endpoint} has no Client Context binder for ${JSON.stringify(projection.context)}`)
      }
      const identity = boundIdentity === undefined
        ? binder?.identity(callerCtx)
        : boundIdentity.value
      if (identity === undefined) {
        throw new Error(`client api: ${endpoint} requires a ${JSON.stringify(projection.context)} Context`)
      }
      args[projection.wire] = parse(projection.codec, identity, endpoint, projection.wire)
    }
    let valueIndex = 0
    descriptor.parameters.forEach((parameter, parameterIndex) => {
      if (parameterIndex === projection?.parameterIndex) return
      const value = parse(parameter.codec, values[valueIndex], endpoint, parameter.wire)
      if (value !== undefined) args[parameter.wire] = value
      valueIndex += 1
    })
    const connection = this.ownerCtx.get('connection') as ConnectionHandle | undefined
    if (connection === undefined) throw new Error(`client api: ${endpoint} has no active Connection`)
    const callerSignal = hasCallerSignal ? values[expected] as AbortSignal | undefined : undefined
    const signal = callerSignal === undefined
      ? token.abort.signal
      : AbortSignal.any([token.abort.signal, callerSignal])
    try {
      const result = await connection.rpc.call('/api', endpoint, { args }, signal)
      if (!mountActive(token)) return withdrawn(endpoint)
      if (!result.ok) return { ok: false, error: result.error }
      return { ok: true, value: parse(descriptor.result, result.value, endpoint, 'result') }
    } catch (error) {
      // Carrier throws (offline, abort, a rejected result payload) are outcomes
      // of the call, not assembly faults, so they join the same error branch.
      return carrierFailure(endpoint, error)
    }
  }
}

type InvokeRemote = (
  direct: DirectMethod | undefined,
  scoped: ScopedMethod | undefined,
  callerCtx: Context,
  args: readonly unknown[],
) => Promise<RemoteResult<unknown>>

class RemoteNamespaceService extends Service {
  private readonly methods = new Map<string, RemoteMethodRecord>()
  private readonly namespace: string

  static assertMethodAvailable(namespace: string, method: string): void {
    if (REMOTE_NAMESPACE_FIELDS.has(method) || method in RemoteNamespaceService.prototype) {
      throw new Error(`client api: method ${JSON.stringify(`${namespace}/${method}`)} conflicts with its namespace service`)
    }
  }

  constructor(
    ctx: Context,
    name: string,
    private readonly invokeRemote: InvokeRemote,
  ) {
    super(ctx, remoteServiceKey(name))
    this.namespace = name
  }

  assertMethodAvailable(method: string): void {
    RemoteNamespaceService.assertMethodAvailable(this.namespace, method)
    if (method in this && !this.methods.has(method)) {
      throw new Error(`client api: method ${JSON.stringify(`${this.namespace}/${method}`)} conflicts with its namespace service`)
    }
  }

  get empty(): boolean {
    return this.methods.size === 0
  }

  has(kind: 'direct' | 'scoped', method: string): boolean {
    return this.methods.get(method)?.[kind] !== undefined
  }

  installDirect(descriptor: InvocationDescriptor, token: MountToken): void {
    this.install(descriptor.method, 'direct', { descriptor, token })
  }

  installScoped(descriptor: InvocationDescriptor, projection: ScopedProjection, token: MountToken): void {
    this.install(descriptor.method, 'scoped', { descriptor, projection, token })
  }

  private install(method: string, kind: 'direct', value: DirectMethod): void
  private install(method: string, kind: 'scoped', value: ScopedMethod): void
  private install(method: string, kind: 'direct' | 'scoped', value: DirectMethod | ScopedMethod): void {
    this.assertMethodAvailable(method)
    let record = this.methods.get(method)
    const fresh = record === undefined
    record ??= {}
    if (fresh) {
      Object.defineProperty(this, method, {
        configurable: true,
        enumerable: true,
        get: function (this: RemoteNamespaceService): (...args: unknown[]) => Promise<RemoteResult<unknown>> {
          const callerCtx = this.ctx
          const current = this.methods.get(method)
          const direct = current?.direct
          const scoped = current?.scoped
          return (...args: unknown[]) => {
            return this.invokeRemote(direct, scoped, callerCtx, args)
          }
        },
      })
      this.methods.set(method, record)
    }
    if (kind === 'direct') record.direct = value
    else record.scoped = value as ScopedMethod
  }

  remove(kind: 'direct' | 'scoped', method: string, token: MountToken): void {
    const record = this.methods.get(method)
    const current = record?.[kind]
    /* v8 ignore next -- duplicate live variants are rejected before installation, so no newer token can replace this one. */
    if (record === undefined || current?.token !== token) return
    if (kind === 'direct') delete record.direct
    else delete record.scoped
    if (record.direct !== undefined || record.scoped !== undefined) return
    this.methods.delete(method)
    Reflect.deleteProperty(this, method)
  }
}

const REMOTE_NAMESPACE_FIELDS = new Set(['ctx', 'empty', 'invokeRemote', 'methods', 'name', 'namespace'])

function remoteServiceKey(namespace: string): string {
  return `remote.${namespace}`
}

function endpointOf(descriptor: Pick<InvocationDescriptor, 'namespace' | 'method'>): string {
  return `${descriptor.namespace}/${descriptor.method}`
}

function mountActive(token: MountToken): boolean {
  return token.active
}

function scopedProjection(descriptor: InvocationDescriptor): ScopedProjection | undefined {
  if (descriptor.invocation.kind === 'context') {
    return {
      context: descriptor.invocation.context,
      wire: descriptor.invocation.wire,
      codec: descriptor.invocation.codec,
    }
  }
  if (descriptor.scope === undefined) return undefined
  const lookupParameters = descriptor.parameters
    .map((parameter, index) => ({ parameter, index }))
    .filter(candidate => candidate.parameter.source === 'lookup')
  const selected = lookupParameters.length === 1 ? lookupParameters[0] : undefined
  if (selected === undefined
    || selected.parameter.wire !== descriptor.scope.wire
    || selected.parameter.lookup !== descriptor.scope.context) {
    throw new Error(
      `client api: generated Remote ${endpointOf(descriptor)} scope must select its only lookup parameter`,
    )
  }
  return {
    context: descriptor.scope.context,
    wire: descriptor.scope.wire,
    codec: selected.parameter.codec,
    parameterIndex: selected.index,
  }
}

function requireStrictDescriptor(descriptor: InvocationDescriptor): void {
  const endpoint = endpointOf(descriptor)
  requireStrictCodec(descriptor.result, endpoint, 'result')
  for (const parameter of descriptor.parameters) {
    requireStrictCodec(parameter.codec, endpoint, parameter.wire)
  }
  if (descriptor.invocation.kind === 'context') {
    requireStrictCodec(descriptor.invocation.codec, endpoint, descriptor.invocation.wire)
  }
}

function requireStrictCodec(codec: TypertCodec, endpoint: string, field: string): void {
  if (codec.mode !== 'strict') {
    throw new Error(`client api: generated Remote ${endpoint} field ${JSON.stringify(field)} has no strict codec`)
  }
}

function parse(codec: TypertCodec, value: unknown, endpoint: string, field: string): unknown {
  if (codec.mode !== 'strict') {
    throw new Error(`client api: generated Remote ${endpoint} field ${JSON.stringify(field)} has no strict codec`)
  }
  try {
    return codec.schema.parse(value)
  } catch (cause) {
    throw new Error(`client api: ${endpoint} rejected ${JSON.stringify(field)}`, { cause })
  }
}

/** The namespace retired before or during the call, so no request outcome exists. */
function withdrawn(endpoint: string): RemoteResult<never> {
  return internalFailure(`client api: Remote method ${endpoint} is no longer mounted`)
}

function carrierFailure(endpoint: string, error: unknown): RemoteResult<never> {
  return internalFailure(`client api: ${endpoint} failed: ${error instanceof Error ? error.message : String(error)}`)
}

function internalFailure(message: string): RemoteResult<never> {
  return { ok: false, error: { code: 'internal', message, details: {} } }
}
