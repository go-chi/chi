/**
 * Pure types of the permission domain: the ONE home of the `permissions`
 * projection-key declaration plus its payload types, free of this package's
 * host-side value imports (cordis, schemastery). Two namespace projections
 * serve it — the package root re-export for host consumers, `./client` (the
 * browser half-entry's re-export) for client aggregates — with zero content
 * duplication.
 *
 * @module @deepseek-ai/dsh-permission-presets/types
 */

/** The select-option shape a presentation layer advertises for one preset (or for the derived `custom` state). */
export interface PresetOption {
  /** Stable option value: the table key, or `custom`. */
  value: string
  /** The display label. */
  name: string
  /** One user-facing sentence on what the value means; omitted when not configured. */
  description?: string
}

/**
 * Whole `permissions` projection value: every switchable preset in table
 * order (plus the derived current-only `custom` when the knobs match no
 * entry) and the effective current value.
 */
export interface PermissionSelect {
  /** Switchable presets, plus `custom` appended exactly while it is current. */
  options: PresetOption[]
  /** The effective current value: a preset table key, or `custom`. */
  currentValue: string
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /**
     * The session's permission select, folded from the three whole-value
     * knob events (`permission/preset`, `sandbox/mode`, `approval/policy`)
     * over the composition defaults. Key absence means no permission service
     * is composed — clients hide the control.
     */
    permissions: PermissionSelect
  }
}
