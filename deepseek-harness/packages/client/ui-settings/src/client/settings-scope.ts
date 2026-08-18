/**
 * Host transport for the settings-namespace scope contract. The contract types
 * live in `dsh-client-runtime` (the common dependency of every feature that
 * owns a preference); this file owns the wire behavior and the invalidation
 * subscription, both of which are Settings-surface concerns.
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type {
  ConnectionHandle, IApiClient, SettingsNamespaceView, SettingsPathOpView,
} from '@deepseek-ai/dsh-api-remotes/client'
import { rehydrateSchema, validateDraft } from '@deepseek-ai/dsh-client-schema-form'
import {
  createSnapshotStore, type SettingsScope, type SettingsScopeSnapshot,
  type SettingsScopeSpec, type SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'
// Type-only, and deliberately NOT `@deepseek-ai/dsh-api-remotes/client`: this
// package is reachable from the Host build graph through its feature-package
// callers, and api-remotes' Client face imports a Host-tsdown-generated
// `/remote` artifact, which would deadlock the Host tsc phase. The gateway's
// Client half declares `ctx.remote` with no generated import, and the
// allowlist's `types` subpath is a pure-type source file, so the pair supplies
// `$on` and its key face without dragging a build artifact in. The runtime
// `remote` injection belongs to whoever calls bindSettingsScope: the
// subscription is registered on the caller's own context.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-remotes/types'
// The forwarded event's own declaration: `$on`'s key face is
// `Extract<keyof Events, keyof Selection>`, so the allowlist alone resolves to
// never — the owning package's client-safe, type-only subpath supplies the
// cordis `Events` entry (and with it the branded `SettingsNamespace`).
import type {} from '@deepseek-ai/dsh-settings/types'
type SettingsFace = Pick<IApiClient, 'settings'>

/**
 * Serializes one namespace's Host reads and writes behind a snapshot store.
 * Reads never block plugin activation; writes carry the latest known
 * namespace revision and teardown waits for the operation already crossing
 * the wire.
 */
export class SettingsScopeController<T> implements SettingsScope<T> {
  private readonly store: SnapshotStore<SettingsScopeSnapshot<T>>
  private tail: Promise<void> = Promise.resolve()
  private readGeneration = 0
  private writeGeneration = 0
  private disposed = false

  /**
   * @param api - settings wire face.
   * @param spec - namespace identity and optional narrowing decoder.
   * @param persistence - remote browsers remain process-local because settings RPCs are loopback-only.
   */
  constructor(
    private readonly api: SettingsFace,
    private readonly spec: SettingsScopeSpec<T>,
    private readonly persistence: 'host' | 'memory' = 'host',
  ) {
    this.store = createSnapshotStore<SettingsScopeSnapshot<T>>({
      status: persistence === 'host' ? 'loading' : 'unavailable',
      value: undefined,
      base: undefined,
      user: undefined,
      revision: undefined,
      writable: false,
      mode: persistence,
    })
  }

  /** @returns the current sync snapshot (stable reference until the next change). */
  getSnapshot(): SettingsScopeSnapshot<T> {
    return this.store.getSnapshot()
  }

  /**
   * Observe snapshot replacements.
   * @param listener - invoked after each snapshot change.
   * @returns the disposer removing this listener.
   */
  subscribe(listener: () => void): () => void {
    return this.store.subscribe(listener)
  }

  /**
   * Queue a Host refresh; a newer read or user write suppresses stale publication.
   * @returns settlement after the queued read completes or is skipped.
   */
  load(): Promise<void> {
    const generation = ++this.readGeneration
    return this.enqueue(() => this.read(generation))
  }

  /**
   * Queue one field write; see {@link SettingsScope.set} for the ordering,
   * revision, and recovery contract.
   * @param field - scalar field inside the namespace section.
   * @param value - JSON-shaped value selected by the user.
   * @returns settlement after the write and any latest-write recovery read.
   */
  set(field: string, value: unknown): Promise<void> {
    return this.write({ op: 'set', path: [field], value })
  }

  /**
   * Queue one field clear; see {@link SettingsScope.unset} for the ordering,
   * revision, and recovery contract.
   * @param field - scalar field inside the namespace section.
   * @returns settlement after the clear and any latest-write recovery read.
   */
  unset(field: string): Promise<void> {
    return this.write({ op: 'unset', path: [field] })
  }

  private write(op: SettingsPathOpView): Promise<void> {
    this.readGeneration += 1
    const generation = ++this.writeGeneration
    return this.enqueue(async () => {
      const revision = this.getSnapshot().revision
      let response: Awaited<ReturnType<SettingsFace['settings']['mutate']>>
      try {
        response = await this.api.settings.mutate({
          ns: this.spec.namespace,
          ops: [op],
          ...(revision === undefined ? {} : { expectedRevision: revision }),
        })
      } catch (_settingsWriteFailure) {
        if (!this.disposed && generation === this.writeGeneration) await this.read(++this.readGeneration)
        return
      }
      if (!response.result.ok) {
        if (!this.disposed && generation === this.writeGeneration) await this.read(++this.readGeneration)
        return
      }
      this.accept(response.result.value, generation === this.writeGeneration)
    })
  }

  /**
   * Stop queued operations and wait for the current wire call to settle.
   * @returns settlement after the controller reaches quiescence.
   */
  async dispose(): Promise<void> {
    this.disposed = true
    this.readGeneration += 1
    this.writeGeneration += 1
    await this.tail
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    if (this.persistence === 'memory' || this.disposed) return Promise.resolve()
    const task = this.tail.then(async () => {
      if (this.disposed) return
      await operation()
    })
    // The returned task carries its own settlement to the caller; the queue
    // tail is kept fulfilled so one failed subscriber cannot strand later operations.
    this.tail = task.catch(() => {})
    return task
  }

  private async read(generation: number): Promise<void> {
    let response: Awaited<ReturnType<SettingsFace['settings']['describe']>>
    try {
      response = await this.api.settings.describe({})
    } catch (_settingsReadFailure) {
      return
    }
    if (!response.result.ok || this.disposed) return
    const { namespaces, writable } = response.result.value
    const view = namespaces.find(candidate => candidate.ns === this.spec.namespace)
    const publish = generation === this.readGeneration
    if (view === undefined) {
      if (publish) {
        this.store.update((draft) => {
          draft.status = 'unavailable'
          draft.writable = writable
        })
      }
      return
    }
    this.accept(view, publish, writable)
  }

  private accept(view: SettingsNamespaceView, publish: boolean, writable?: boolean): void {
    const decoded = publish ? this.decode(view) : undefined
    this.store.update((draft) => {
      draft.revision = view.revision
      draft.base = view.base
      draft.user = view.user
      if (writable !== undefined) draft.writable = writable
      if (decoded === undefined) return
      draft.status = 'ready'
      draft.value = decoded
    })
  }

  private decode(view: SettingsNamespaceView): T | undefined {
    if (this.spec.decode !== undefined) return this.spec.decode(view.value)
    // Sections are plain objects by construction; schemastery alone would
    // resolve null or an array through object defaults instead of refusing.
    if (typeof view.value !== 'object' || view.value === null || Array.isArray(view.value)) return undefined
    let failure: string | undefined
    try {
      failure = validateDraft(rehydrateSchema(view.schema), view.value)
    } catch (_malformedSchemaEnvelope) {
      // A schema envelope this client cannot rehydrate vouches for no section;
      // the value is treated exactly like a schema-invalid one.
      return undefined
    }
    return failure === undefined ? view.value as T : undefined
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    settingsScope: SettingsScopeBinder
  }
}

/**
 * The settings domain's base service. Features that own a preference reach the
 * settings transport through this service rather than a shared function: the
 * client bundle purity gate forbids cross-plugin value imports and directs
 * cross-plugin collaboration through cordis services
 * (`packages/client/tsdown.client.ts`).
 */
export class SettingsScopeBinder extends Service {
  /**
   * @param ctx - the providing plugin's context.
   */
  constructor(ctx: Context) {
    super(ctx, 'settingsScope')
  }

  /**
   * Bind one namespace scope to settings and connection invalidations on the
   * CALLER's plugin lifecycle — the service proxy binds `this.ctx` to the
   * caller at call time, so the scope's disposer belongs to the calling fiber.
   * Listeners exist before the initial background read starts, so activation
   * never blocks on the settings transport. The caller injects `connection`
   * for the transport and `remote` for the forwarded settings invalidation.
   * @param spec - domain-owned namespace contract.
   * @returns the bound scope consumed by the domain's services and rows.
   */
  bind<T>(spec: SettingsScopeSpec<T>): SettingsScope<T> {
    const ctx = this.ctx
    const connection = ctx.get('connection') as ConnectionHandle
    const controller = new SettingsScopeController<T>(
      connection.api,
      spec,
      connection.isLoopback ? 'host' : 'memory',
    )
    ctx.effect(() => {
      const refresh = (namespace?: string): void => {
        if (namespace !== undefined && namespace !== spec.namespace) return
        void controller.load()
      }
      const disposers = [
        (ctx.get('remote') as Context['remote']).$on('settings/document-updated', refresh),
        ctx.on('connection/reset', () => { refresh() }),
      ]
      void controller.load()
      return async () => {
        for (const dispose of disposers) dispose()
        await controller.dispose()
      }
    }, `ui-settings: ${spec.namespace} settings scope`)
    return controller
  }
}
