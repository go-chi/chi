/** Pure replay-safe render intents for Cordis tools. */

import type { GenericCallView } from '@deepseek-ai/dsh-tools'

/**
 * Render a runtime-inspection call.
 * @param args - requested runtime category and optional member name.
 * @returns replay-safe generic call presentation.
 */
export function presentRuntimeInspectCall(args: { what?: string; name?: string }): GenericCallView {
  const target = args.name === undefined ? args.what : `${args.what}: ${args.name}`
  return { card: 'generic', kind: 'read', title: target === undefined ? 'Inspect Cordis runtime' : `Inspect Cordis runtime: ${target}` }
}

/**
 * Render provider-directory inspection.
 * @returns replay-safe generic call presentation.
 */
export function presentInspectListCall(): GenericCallView {
  return { card: 'generic', kind: 'read', title: 'List Cordis Inspect Providers' }
}

/**
 * Render one provider query.
 * @param args - target platform, provider, and method.
 * @returns replay-safe generic call presentation.
 */
export function presentInspectQueryCall(args: { platform: string; provider: string; method: string }): GenericCallView {
  return { card: 'generic', kind: 'read', title: `Query Cordis ${args.platform} ${args.provider}.${args.method}` }
}

/**
 * Render layered self-inspection.
 * @param args - optional Plugin and Package identity.
 * @returns replay-safe generic call presentation.
 */
export function presentInspectSelfCall(args: { pluginId?: string; packageId?: string }): GenericCallView {
  const target = args.pluginId === undefined
    ? 'dynamic Cordis Plugins'
    : args.packageId === undefined ? args.pluginId : `${args.pluginId}/${args.packageId}`
  return { card: 'generic', kind: 'read', title: `Inspect ${target}` }
}

/**
 * Render an immutable Package source-inspection call.
 * @param args - exact Plugin and Package identity.
 * @returns replay-safe generic call presentation.
 */
export function presentPackageInspectCall(args: { pluginId: string; packageId: string }): GenericCallView {
  return { card: 'generic', kind: 'read', title: `Inspect Cordis Package ${args.pluginId}/${args.packageId}` }
}

/**
 * Render a new or appended Package definition.
 * @param args - target Plugin, Package metadata, and source halves.
 * @returns replay-safe generic call presentation with source in raw input.
 */
export function presentDefineCall(args: {
  plugin: { kind: 'new'; idPrefix: string } | { kind: 'existing'; pluginId: string }
  name: string
  purpose: string
  code: { host?: string; client?: string }
}): GenericCallView {
  const target = args.plugin.kind === 'new' ? `new ${args.plugin.idPrefix}-*` : args.plugin.pluginId
  return {
    card: 'generic',
    kind: 'execute',
    title: `Register Cordis Plugin "${args.name}" for ${target}: ${args.purpose}`,
    rawInput: args.code,
  }
}

/**
 * Render Plugin removal.
 * @param args - Plugin identity to remove.
 * @returns replay-safe generic call presentation.
 */
export function presentUndefineCall(args: { pluginId: string }): GenericCallView {
  return { card: 'generic', kind: 'delete', title: `Remove Cordis Plugin ${args.pluginId}` }
}

/**
 * Render one exact Package activation.
 * @param args - Plugin, Package, and activation mode.
 * @returns replay-safe generic call presentation.
 */
export function presentRunCall(args: { pluginId: string; packageId: string; mode: 'run' | 'update' }): GenericCallView {
  return {
    card: 'generic',
    kind: 'execute',
    title: `${args.mode === 'update' ? 'Update' : 'Run'} Cordis Plugin ${args.pluginId} · ${args.packageId}`,
  }
}

/**
 * Render Plugin stop.
 * @param args - Plugin identity to stop.
 * @returns replay-safe generic call presentation.
 */
export function presentStopCall(args: { pluginId: string }): GenericCallView {
  return { card: 'generic', kind: 'execute', title: `Stop Cordis Plugin ${args.pluginId}` }
}
