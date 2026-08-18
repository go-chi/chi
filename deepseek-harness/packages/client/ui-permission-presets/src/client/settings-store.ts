/**
 * Permission default-settings controller. The host descriptor supplies the
 * current value and the dynamic preset enum; writes target only
 * `defaultPreset` and carry the descriptor revision.
 */

import type {
  IApiClient, SettingsNamespaceView,
} from '@deepseek-ai/dsh-api-remotes/client'
import {
  createSnapshotStore, type SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  nodeAtPath, rehydrateSchema, type SchemaNode,
} from '@deepseek-ai/dsh-client-schema-form'
import { displayPermissionPreset } from './presentation.ts'

/** Permission's settings namespace on the host wire. */
export const PERMISSION_SETTINGS_NS = 'permission'

/** One selectable new-session default. */
export interface PermissionDefaultOption {
  /** Preset key written to Settings. */
  id: string
  /** Host-supplied label or a title-cased preset key. */
  label: string
}

/** Permission settings-row snapshot. */
export interface PermissionSettingsState {
  status: 'idle' | 'loading' | 'ready' | 'saving' | 'unavailable' | 'error'
  error: string | null
  writable: boolean
  currentValue: string
  options: readonly PermissionDefaultOption[]
  revision: number
}

interface ConstChoice {
  type: string
  value?: unknown
  meta?: { description?: unknown }
}

/**
 * Read the dynamic preset enum encoded by the host's `defaultPreset` schema.
 * @param view - permission namespace descriptor.
 * @returns current value and selectable options.
 */
export function permissionDefaultOf(view: SettingsNamespaceView): {
  currentValue: string
  options: PermissionDefaultOption[]
} {
  const value = (view.value as { defaultPreset?: unknown } | null)?.defaultPreset
  if (typeof value !== 'string') throw new Error('permission settings has no defaultPreset value')
  const node = nodeAtPath(rehydrateSchema(view.schema), ['defaultPreset'])
  if (node === undefined) throw new Error('permission settings schema has no defaultPreset field')
  const rawChoices = node.type === 'union'
    ? (node.list as SchemaNode[] | undefined) ?? []
    : [node]
  const options = rawChoices.flatMap((candidate) => {
    const choice = candidate as unknown as ConstChoice
    if (choice.type !== 'const' || typeof choice.value !== 'string') return []
    const described = choice.meta?.description
    return [{
      id: choice.value,
      label: typeof described === 'string' && described.length > 0
        ? displayPermissionPreset(choice.value, described)
        : displayPermissionPreset(choice.value, choice.value),
    }]
  })
  if (options.length === 0 || !options.some(option => option.id === value)) {
    throw new Error('permission settings schema does not advertise its current preset')
  }
  return { currentValue: value, options }
}

/** Controller joining Settings reads, writes, and pushed invalidations. */
export class PermissionPresetSettingsController {
  /** Row snapshot consumed through a bound selector hook. */
  readonly store: SnapshotStore<PermissionSettingsState> = createSnapshotStore({
    status: 'idle',
    error: null,
    writable: false,
    currentValue: '',
    options: [],
    revision: 0,
  })

  private generation = 0
  private view: SettingsNamespaceView | undefined

  /** @param api - Settings wire face. */
  constructor(private readonly api: Pick<IApiClient, 'settings'>) {}

  /**
   * Refresh the permission descriptor. Latest request wins.
   * @returns nothing; {@link store} carries success or failure.
   */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((state) => {
      state.status = 'loading'
      state.error = null
    })
    try {
      const response = await this.api.settings.describe({})
      if (!response.result.ok) throw new Error(response.result.error.message)
      if (generation !== this.generation) return
      const view = response.result.value.namespaces.find(entry => entry.ns === PERMISSION_SETTINGS_NS)
      if (view === undefined) {
        this.view = undefined
        this.store.update((state) => {
          state.status = 'unavailable'
          state.writable = false
          state.currentValue = ''
          state.options = []
        })
        return
      }
      this.accept(view, response.result.value.writable)
    } catch (error) {
      if (generation !== this.generation) return
      this.fail(error)
    }
  }

  /**
   * Persist one preset as the default for subsequently created sessions.
   * @param preset - advertised preset key.
   * @returns nothing; {@link store} carries success or failure.
   */
  async select(preset: string): Promise<void> {
    const view = this.view
    const state = this.store.getSnapshot()
    if (view === undefined || !state.writable) return
    const generation = ++this.generation
    this.store.update((draft) => {
      draft.status = 'saving'
      draft.error = null
    })
    try {
      const response = await this.api.settings.mutate({
        ns: PERMISSION_SETTINGS_NS,
        ops: [{ op: 'set', path: ['defaultPreset'], value: preset }],
        expectedRevision: view.revision,
      })
      if (generation !== this.generation) return
      if (!response.result.ok) throw new Error(response.result.error.message)
      this.accept(response.result.value, true)
    } catch (error) {
      if (generation !== this.generation) return
      this.fail(error)
    }
  }

  /** Stop in-flight responses from publishing after plugin disposal. */
  dispose(): void {
    this.generation += 1
    this.view = undefined
  }

  private accept(view: SettingsNamespaceView, writable: boolean): void {
    const resolved = permissionDefaultOf(view)
    this.view = view
    this.store.update((state) => {
      state.status = 'ready'
      state.error = null
      state.writable = writable
      state.currentValue = resolved.currentValue
      state.options = resolved.options
      state.revision = view.revision
    })
  }

  private fail(error: unknown): void {
    this.store.update((state) => {
      state.status = 'error'
      state.error = error instanceof Error ? error.message : String(error)
    })
  }
}

/**
 * Refetch only after the row has opened once.
 * @param controller - permission settings controller.
 */
export function refreshPermissionIfLoaded(controller: PermissionPresetSettingsController): void {
  if (controller.store.getSnapshot().status === 'idle') return
  void controller.load()
}
