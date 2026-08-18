/**
 * User-facing permission presets over the independent sandbox-mode and
 * approval-policy knobs. A switch records the selected preset, then writes
 * changed knobs through their canonical setters. Execution, prompt narration,
 * and replay keep reading their knob folds. The preset event preserves user
 * intent when two presets share a bundle. The read side ships as the
 * `permissions` session projection; the write side ships as the
 * `/permission` command — both optional children over the same service.
 *
 * @module dsh-permission-presets
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'
import { SANDBOX_MODES, effectiveSandboxMode, setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
// Side-effect type import: declaration-merges `ctx.shell` (the capability fact
// `sandboxMode` this service reads), without a value dependency on the seam.
import type {} from '@deepseek-ai/dsh-shell'
import type { ApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import { APPROVAL_POLICIES, effectiveApprovalPolicy, setApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
// Type-only: resolves ctx.sessionProjections / ctx.commands for the optional children.
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-commands'
import type { PermissionSelect, PresetOption } from './types.ts'

// The `permissions` projection-key declaration lives in src/types.ts (its one
// home); this re-export projects the type face onto the package root AND
// keeps the module edge in the emitted index.d.ts, so aggregate programs
// consuming the declarations still receive the SessionProjectionMap merge.
export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    permissionPresets: PermissionPresetService
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Records the selected preset as durable, log-only user intent. The knob
     * events follow in the same turn and control execution; this event stays
     * out of the model transcript and lets {@link effectivePermissionPreset}
     * preserve a selection when bundles match.
     */
    'permission/preset': { preset: string }
  }
}

/** One preset's sandbox/approval bundle and optional client presentation. */
export interface PresetSpec {
  /** The `sandbox/mode` value the preset writes through. */
  sandbox: SandboxMode
  /** The `approval/policy` value the preset writes through. */
  approval: ApprovalPolicy
  /** The display label a client shows for this preset; the raw table key when omitted. */
  name?: string
  /** One user-facing sentence on what the preset means; omitted when not configured. */
  description?: string
}

/**
 * Returned when effective knob values match no table entry. Clients may show
 * it as the current value, but it is never a switch target or event payload.
 */
export const CUSTOM_PRESET = 'custom'

/** Settings namespace carrying the default for future sessions. */
export const PERMISSION_SETTINGS_NAMESPACE = settingsNamespace('permission')

/**
 * Fold the last selected preset from the durable log; replay needs no catch-up
 * state.
 * @param events - session events in log order; other event types are ignored.
 * @returns the last selected preset, or undefined when none was recorded.
 */
export function effectivePermissionPreset(events: readonly SessionEvent[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index] as SessionEvent
    if (event.type === 'permission/preset') return event.data.preset
  }
  return undefined
}

/**
 * The projection unit's state: the last seen value of each knob event, null
 * before an override (composition defaults apply at view time). Plain JSON
 * (persisted-cache precondition).
 */
export interface KnobState {
  /** Last `permission/preset` payload, or null. */
  preset: string | null
  /** Last `sandbox/mode` payload, or null. */
  sandbox: SandboxMode | null
  /** Last `approval/policy` payload, or null. */
  approval: ApprovalPolicy | null
}

/** State for the empty log: every knob at its composition default. */
const EMPTY_KNOBS: KnobState = { preset: null, sandbox: null, approval: null }

/**
 * One-event knob transition (the projection unit's `apply`). Uninterested
 * events return the same reference — the registry's change gate.
 * @param state - the folded knob state before `event`.
 * @param event - one committed session event.
 * @returns the next state; the same reference when the event is not a knob.
 */
export function applyKnobEvent(state: KnobState, event: SessionEvent): KnobState {
  switch (event.type) {
    case 'permission/preset':
      return { ...state, preset: event.data.preset }
    case 'sandbox/mode':
      return { ...state, sandbox: event.data.mode }
    case 'approval/policy':
      return { ...state, approval: event.data.policy }
    default:
      return state
  }
}

/** Whole-log knob fold (the cold-read parallel of {@link applyKnobEvent}). */
function foldKnobs(events: readonly SessionEvent[]): KnobState {
  let state = EMPTY_KNOBS
  for (const event of events) state = applyKnobEvent(state, event)
  return state
}

/** User setting resolved when a new session receives its initial permission. */
export interface PermissionSettings {
  /** Preset pinned into a newly created session. */
  defaultPreset: string
}

/** The {@link PermissionPresetService} config: preset table and composition default. */
export interface Config {
  /**
   * The preset table: name → knob bundle. Defaults to `workspace-write`
   * (workspace-write + ask) and `danger-full-access` (danger-full-access +
   * never). The name `custom` is reserved for the derived not-a-preset state.
   */
  presets?: Record<string, PresetSpec>
  /**
   * Default for new sessions. When omitted, the preset matching the composed
   * sandbox and approval defaults is used.
   */
  defaultPreset?: string
}

/**
 * Owns the deployment's permission presets and their write path. Requires a
 * confining `ctx.shell` executor and `ctx.approval`; unmatched knob values are
 * reported as {@link CUSTOM_PRESET}, not an error.
 */
export class PermissionPresetService extends Service {
  // Inline schema call: the config catalog walks `static Config` statically.
  static Config: z<Config> = z.object({
    presets: z.dict(z.object({
      sandbox: z.union(SANDBOX_MODES as SandboxMode[]).required(),
      approval: z.union(APPROVAL_POLICIES as ApprovalPolicy[]).required(),
      name: z.string(),
      description: z.string(),
    })).default({
      'workspace-write': {
        sandbox: 'workspace-write', approval: 'ask',
        name: 'workspace-write', description: 'Write inside the workspace and permitted temporary directories; wider retries require approval.',
      },
      'danger-full-access': {
        sandbox: 'danger-full-access', approval: 'never',
        name: 'danger-full-access', description: 'Full file access without approval prompts.',
      },
    }),
    defaultPreset: z.string(),
  })

  static inject = ['shell', 'approval', 'sessions']

  private readonly presets: Record<string, PresetSpec>
  private defaultSettings: () => PermissionSettings

  constructor(ctx: Context, config: Config) {
    super(ctx, 'permissionPresets')
    // The schema defaulted the table — the cast records that runtime fact.
    this.presets = config.presets as Record<string, PresetSpec>
    if (CUSTOM_PRESET in this.presets) {
      throw new Error(`permission: "${CUSTOM_PRESET}" is reserved for the derived not-a-preset state and cannot name a table entry`)
    }
    if (ctx.shell.sandboxMode === undefined) {
      throw new Error('permission: the mounted bash executor does not confine (no sandboxMode) — presets bundle a sandbox mode, so composing this plugin over an unconfined executor is a misconfiguration')
    }
    const inferredDefault = this.derive(EMPTY_KNOBS)
    const defaultPreset = config.defaultPreset ?? inferredDefault
    if (defaultPreset === CUSTOM_PRESET) {
      throw new Error('permission: composed sandbox and approval defaults match no preset; configure defaultPreset explicitly')
    }
    this.resolve(defaultPreset)
    const baseSettings: PermissionSettings = { defaultPreset }
    this.defaultSettings = () => baseSettings
    const presetChoices = this.names.map((name) => {
      const choice = z.const(name)
      const label = this.presets[name]?.name
      return label === undefined ? choice : choice.description(label)
    })
    const settingsSchema: z<PermissionSettings> = z.object({
      defaultPreset: z.union(presetChoices).required(),
    })
    installSettingsSection(ctx, PERMISSION_SETTINGS_NAMESPACE, settingsSchema, baseSettings, {
      setSource: (current) => {
        this.defaultSettings = current
      },
      // The source thunk reads the latest scope snapshot at session creation;
      // no process-level registration needs replacement on change.
      onChange: () => {},
    })

    ctx.on('session/created', (session) => {
      this.pinInitialPermission(session)
    })
    for (const session of ctx.sessions.list()) {
      this.pinInitialPermission(session)
    }

    // The permissions projection unit: fold the three whole-value knob
    // events; view derives the select over the composition defaults this
    // service already owns. The unit child activates only when a projection
    // registry is composed (headless assemblies stay unaffected).
    // zod `.optional()` types the key `string | undefined` while the domain
    // says `description?: string`; on the JSON wire the two serialize
    // identically (absent), so the cast records exactly that
    // exactOptionalPropertyTypes widening (the Wire<T> precedent).
    const selectSchema = zod.object({
      options: zod.array(zod.object({
        value: zod.string().min(1),
        name: zod.string().min(1),
        description: zod.string().optional(),
      })),
      currentValue: zod.string().min(1),
    }) as unknown as zod.ZodType<PermissionSelect>
    ctx.inject(['sessionProjections'], (projectionCtx) => {
      projectionCtx.sessionProjections.register<'permissions', KnobState>({
        key: 'permissions',
        schema: selectSchema,
        init: () => EMPTY_KNOBS,
        apply: applyKnobEvent,
        view: state => this.selectFor(state),
        stateVersion: 1,
      })
    })

    // The /permission command: the one write path a web client uses (the
    // popup contribution submits the picked preset as this line). The child
    // activates only when a command registry is composed.
    ctx.inject(['commands'], (commandCtx) => {
      commandCtx.commands.register({
        name: 'permission',
        description: 'Switch the permission preset (sandbox mode + approval policy)',
        input: { hint: '<preset>' },
        // No settlement text labels its value with this command's own name: a
        // surface that renders `name · text` (the web command row) would
        // otherwise read `permission · Permission preset: workspace-write.`
        handler: ({ agent, rawInput }) => {
          const name = rawInput.trim()
          if (name === '') {
            return { kind: 'success', text: `current preset ${this.current(agent.session.events)} (available: ${this.names.join(', ')})` }
          }
          if (!this.names.includes(name)) {
            return { kind: 'error', text: `unknown preset "${name}" (available: ${this.names.join(', ')})` }
          }
          this.apply(agent.session, name, (policy) =>{  this.ctx.approval.setPolicy(agent, policy) })
          return { kind: 'success', text: `preset ${name}` }
        },
      })
    })
  }

  /**
   * The advertised preset names, in the preset table's declaration order.
   * @returns every switchable preset name.
   */
  get names(): readonly string[] {
    return Object.keys(this.presets)
  }

  /**
   * The preset currently selected as the default for future sessions.
   * @returns the resolved settings value, or the composition default without
   * a mounted settings provider.
   */
  get defaultPreset(): string {
    return this.defaultSettings().defaultPreset
  }

  /**
   * Resolve the preset matching the effective knob values. A still-matching
   * last selection wins shared-bundle ties; otherwise the first table match
   * wins, or {@link CUSTOM_PRESET} when no entry matches.
   * @param events - the session's events in log order.
   * @returns the effective preset name, or `custom` when nothing matches.
   */
  current(events: readonly SessionEvent[]): string {
    return this.derive(foldKnobs(events))
  }

  /** Resolve the preset for one folded knob state (the shared mathematics of `current` and the projection unit). */
  private derive(state: KnobState): string {
    const sandbox = state.sandbox ?? this.ctx.shell.sandboxMode
    const approval = state.approval ?? this.ctx.approval.config.policy ?? 'ask'
    const matches = (spec: PresetSpec): boolean => spec.sandbox === sandbox && spec.approval === approval
    if (state.preset !== null) {
      const spec = this.presets[state.preset]
      if (spec !== undefined && matches(spec)) return state.preset
    }
    for (const [name, spec] of Object.entries(this.presets)) {
      if (matches(spec)) return name
    }
    return CUSTOM_PRESET
  }

  /**
   * Build the whole select value for one folded knob state: every table
   * option in declaration order, `custom` appended exactly while derived.
   * @param state - the folded knob overrides.
   * @returns the `permissions` projection payload.
   */
  selectFor(state: KnobState): PermissionSelect {
    const currentValue = this.derive(state)
    return {
      options: [
        ...this.names.map(name => this.optionOf(name)),
        ...currentValue === CUSTOM_PRESET ? [this.optionOf(CUSTOM_PRESET)] : [],
      ],
      currentValue,
    }
  }

  /**
   * Resolve a preset's knob bundle.
   * @param name - the preset name to resolve.
   * @returns the configured bundle.
   * @throws when `name` is not in the table.
   */
  resolve(name: string): PresetSpec {
    const spec = this.presets[name]
    if (spec === undefined) {
      throw new Error(`permission: unknown preset "${name}" (known: ${Object.keys(this.presets).join(', ')})`)
    }
    return spec
  }

  /**
   * Build the client option for a table entry or {@link CUSTOM_PRESET}. A
   * missing label falls back to the table key.
   * @param name - a table key, or `custom`.
   * @returns the option a client renders.
   * @throws when `name` is neither a table key nor `custom`.
   */
  optionOf(name: string): PresetOption {
    if (name === CUSTOM_PRESET) {
      return { value: CUSTOM_PRESET, name: 'Custom', description: 'Current sandbox and approval settings do not match a preset.' }
    }
    const spec = this.resolve(name)
    return { value: name, name: spec.name ?? name, ...spec.description !== undefined ? { description: spec.description } : {} }
  }

  /**
   * Record a changed preset, then update each changed knob through its own
   * setter. Selecting the effective preset again appends nothing.
   * @param session - the session the switch belongs to.
   * @param name - the preset to switch to; unknown names throw.
   */
  set(session: Session, name: string): void {
    this.apply(session, name, (policy) =>{  setApprovalPolicy(session, policy) })
  }

  /** Apply one preset with the caller-selected live or initialization policy writer. */
  private apply(session: Session, name: string, setApproval: (policy: ApprovalPolicy) => void): void {
    const spec = this.resolve(name)
    if (this.current(session.events) !== name) {
      session.append('permission/preset', { preset: name })
    }
    const events = session.events
    if (spec.sandbox !== (effectiveSandboxMode(events) ?? this.ctx.shell.sandboxMode)) {
      setSandboxMode(session, spec.sandbox)
    }
    if (spec.approval !== (effectiveApprovalPolicy(events) ?? this.ctx.approval.config.policy ?? 'ask')) {
      setApproval(spec.approval)
    }
  }

  /**
   * Fill every missing permission fact before a session is published. A
   * genuinely fresh session uses the current user default; seeded or partially
   * initialized sessions preserve their effective knob values and only gain
   * the missing durable facts.
   */
  private pinInitialPermission(session: Session): void {
    const events = session.events
    const selected = effectivePermissionPreset(events)
    const sandbox = effectiveSandboxMode(events)
    const approval = effectiveApprovalPolicy(events)
    const seeded = events.some(event => event.type === 'session/end-seed')
    if (selected === undefined && sandbox === undefined && approval === undefined && !seeded) {
      const name = this.defaultPreset
      const spec = this.resolve(name)
      session.append('permission/preset', { preset: name })
      setSandboxMode(session, spec.sandbox)
      setApprovalPolicy(session, spec.approval)
      return
    }

    const state: KnobState = {
      preset: selected ?? null,
      sandbox: sandbox ?? null,
      approval: approval ?? null,
    }
    const effective = this.derive(state)
    if (selected === undefined && effective !== CUSTOM_PRESET) {
      session.append('permission/preset', { preset: effective })
    }
    if (sandbox === undefined) {
      setSandboxMode(session, this.ctx.shell.sandboxMode as SandboxMode)
    }
    if (approval === undefined) {
      setApprovalPolicy(session, this.ctx.approval.config.policy ?? 'ask')
    }
  }
}

export default PermissionPresetService
