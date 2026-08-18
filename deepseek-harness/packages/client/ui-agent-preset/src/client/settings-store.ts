/**
 * Agent-preset default-settings controller.
 *
 * Options and the current default both come from one `agentPreset.list` call:
 * the roster already reports which id a session with no explicit choice gets,
 * so the row needs no schema introspection. Writes target the settings
 * namespace's `default` field, which is what the host resolves at creation.
 */

import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** The agent-preset settings namespace on the host wire. */
export const AGENT_PRESET_SETTINGS_NS = 'agent-presets'

/**
 * Human text for a rejected wire call. A transport failure rejects with an
 * Error; a host or a runtime can reject with anything, and the surface still
 * has to say something.
 * @param error - the rejection value.
 * @returns the message to show.
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Persist one preset as the default for sessions created later.
 *
 * The default is a settings field rather than a preset property, so both the
 * General row and the management section write it here — one home for which
 * namespace and field the host resolves at session creation.
 * @param api - the settings wire face.
 * @param id - the preset to make default.
 * @returns the failure message, or undefined once the write landed.
 */
export async function writeDefaultPreset(
  api: Pick<IApiClient, 'settings'>,
  id: string,
): Promise<string | undefined> {
  let response
  try {
    response = await api.settings.update({ ns: AGENT_PRESET_SETTINGS_NS, patch: { default: id } })
  } catch (error) {
    // The transport rejected rather than answering; the caller must be able to
    // say so instead of the row silently snapping back.
    return messageOf(error)
  }
  return response.result.ok ? undefined : response.result.error.message
}

/** One selectable preset. */
export interface AgentPresetOption {
  /** Preset id, written to Settings and the label's fallback. */
  id: string
  /** Whether the preset ships with the deployment or was authored locally. */
  trust: 'system' | 'user'
  /** Display name the preset published, absent when it published none. */
  name?: string
  /** One sentence on what the preset is for. */
  description?: string
}

/** One roster entry exactly as the host reports it. */
export interface RosterPreset {
  /** Preset id and directory name. */
  id: string
  /** Whether the preset ships with the deployment or was authored locally. */
  trust: 'system' | 'user'
  /** Whether a session that names no preset gets this one. */
  isDefault: boolean
  /** Display name the preset published, absent when it published none. */
  name?: string
  /** One sentence on what the preset is for. */
  description?: string
  /** Why the preset cannot compose a session, absent when it can. */
  broken?: string
}

/** The roster the host answered with. */
export interface RosterValue {
  /** Every preset the deployment composes, in the order the host lists them. */
  presets: readonly RosterPreset[]
  /** Whether this browser may author presets at all. */
  authorable: boolean
  /** Whether the host can open a preset directory on a native desktop. */
  hasDocument: boolean
}

/** The roster, or the message to show in its place. */
export type RosterRead = { ok: true; value: RosterValue } | { ok: false; error: string }

/**
 * Read the roster, folding both refusal shapes into one message.
 *
 * The wire refuses in two ways — the transport rejects, or it answers an
 * `ok: false` envelope — and every surface treats them identically. Folding
 * them here keeps each store's `load` about what it does with a roster rather
 * than about how the call can fail.
 * @param api - the agent-preset wire face.
 * @returns the roster, or the message to show in its place.
 */
export async function readRoster(api: Pick<IApiClient, 'agentPresets'>): Promise<RosterRead> {
  try {
    const response = await api.agentPresets.list({})
    return response.result.ok
      ? { ok: true, value: response.result.value }
      : { ok: false, error: response.result.error.message }
  } catch (error) {
    return { ok: false, error: messageOf(error) }
  }
}

/**
 * The opening move every roster-backed surface makes: refuse a read that is
 * already in flight, mark the store loading, then read.
 *
 * A surface that gets `undefined` returns without touching its snapshot
 * further — either another read owns it, or this one already wrote the
 * failure. What differs between surfaces starts after this.
 * @param api - the agent-preset wire face.
 * @param store - the surface's own snapshot store.
 * @returns the roster, or undefined when the caller should return.
 */
export async function beginRosterRead<S extends { status: string; error: string | null }>(
  api: Pick<IApiClient, 'agentPresets'>,
  store: SnapshotStore<S>,
): Promise<RosterValue | undefined> {
  const before = store.getSnapshot()
  if (before.status === 'loading') return undefined
  store.set({ ...before, status: 'loading', error: null })
  const roster = await readRoster(api)
  if (roster.ok) return roster.value
  store.set({ ...store.getSnapshot(), status: 'error', error: roster.error })
  return undefined
}

/**
 * The roster entries as the pickers render them: healthy presets only.
 *
 * The chip and the row exist to choose the NEXT session's composition, and a
 * broken preset cannot compose one — offering it would defer the discovery
 * of that fact to a failed session start. The management section renders the
 * full roster (broken rows included) from its own store instead.
 *
 * The chip, the row, and the management section all show the same facts, and
 * `exactOptionalPropertyTypes` makes "absent" and "present as undefined"
 * different shapes — so the spread dance belongs in one place rather than
 * once per store.
 * @param presets - the roster the host answered with.
 * @returns one option per selectable preset, in roster order.
 */
export function presetOptions(
  presets: readonly { id: string; trust: 'system' | 'user'; name?: string; description?: string; broken?: string }[],
): AgentPresetOption[] {
  return presets.filter(preset => preset.broken === undefined).map(preset => ({
    id: preset.id,
    trust: preset.trust,
    ...preset.name === undefined ? {} : { name: preset.name },
    ...preset.description === undefined ? {} : { description: preset.description },
  }))
}

/** Agent-preset settings-row snapshot. */
export interface AgentPresetSettingsState {
  status: 'idle' | 'loading' | 'ready' | 'saving' | 'unavailable' | 'error'
  error: string | null
  /**
   * Whether this browser may persist the choice at all. `settings.describe` is
   * loopback-only and reports a read-only provider as `writable: false`; the
   * row then shows the current default and disables the control rather than
   * offering a write the gateway will refuse.
   */
  writable: boolean
  currentValue: string
  options: readonly AgentPresetOption[]
}

const INITIAL: AgentPresetSettingsState = {
  status: 'idle',
  error: null,
  // Assumed until `load()` asks; a row that has not read yet renders nothing
  // interactive anyway (status 'idle').
  writable: true,
  currentValue: '',
  options: [],
}

/** Reads the roster and persists the chosen default. */
export class AgentPresetSettingsController {
  /** Row snapshot the renderer subscribes to. */
  readonly store: SnapshotStore<AgentPresetSettingsState> = createSnapshotStore(INITIAL)

  constructor(private readonly api: IApiClient) {}

  private set(patch: Partial<AgentPresetSettingsState>): void {
    this.store.set({ ...this.store.getSnapshot(), ...patch })
  }

  /**
   * Load the roster. An empty roster means the deployment composes no
   * presets, which is a valid deployment rather than a failure — the row
   * reports `unavailable` and renders nothing.
   * @returns once the snapshot reflects the host.
   */
  async load(): Promise<void> {
    const roster = await beginRosterRead(this.api, this.store)
    if (roster === undefined) return
    const { presets } = roster
    const [first] = presets
    if (first === undefined) {
      this.set({ status: 'unavailable', options: [], currentValue: '' })
      return
    }
    try {
      // The roster says what may be chosen; `settings.describe` says whether
      // this browser may write the choice down. A non-loopback browser reaches
      // neither method, so a refused describe leaves the row read-only rather
      // than offering a control whose write the Host would refuse.
      const described = await this.api.settings.describe({})
      this.set({
        status: 'ready',
        error: null,
        writable: described.result.ok && described.result.value.writable,
        options: presetOptions(presets),
        // A roster can mark nothing default: settings can name a preset that
        // was since deleted, and the picker still has to show something.
        currentValue: presets.find(preset => preset.isDefault)?.id ?? first.id,
      })
    } catch (error) {
      this.set({ status: 'error', error: messageOf(error) })
    }
  }

  /**
   * Persist one preset as the default for sessions created later. Running
   * sessions keep the composition they were created with, so this never
   * disturbs work in progress.
   * @param id - the preset to make default.
   * @returns once the write settled and the roster was re-read.
   */
  async select(id: string): Promise<void> {
    const before = this.store.getSnapshot()
    if (before.status === 'saving' || id === before.currentValue) return
    this.set({ status: 'saving', error: null, currentValue: id })
    const failure = await writeDefaultPreset(this.api, id)
    if (failure !== undefined) {
      this.set({ status: 'ready', currentValue: before.currentValue, error: failure })
      return
    }
    // Re-read rather than trust the patch: the host resolves the default
    // through the same roster the row displays.
    await this.load()
  }
}
