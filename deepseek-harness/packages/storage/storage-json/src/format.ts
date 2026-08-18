/**
 * On-disk JSON unit format: the file is always the current net state, kept
 * human-readable (pretty-printed, stable key order from insertion) — that
 * legibility is this backend's reason to exist.
 * @module @deepseek-ai/dsh-storage-json/src/format
 */

import { StorageError } from '@deepseek-ai/dsh-storage'
import type { KvUnitDescriptor } from '@deepseek-ai/dsh-storage'

/** In-memory authoritative state of one unit; the file is its projection. `global` is `null` until first written. */
export interface UnitState {
  version: number
  global: unknown
  tables: Map<string, Map<string, unknown>>
}

/**
 * Serialize a unit state to file content.
 * @param name - Unit name, stamped into the header.
 * @param state - Authoritative in-memory state.
 * @returns pretty-printed JSON document with a trailing newline.
 */
export function serialize(name: string, state: UnitState): string {
  const tables: Record<string, Record<string, unknown>> = {}
  for (const [table, records] of state.tables) {
    tables[table] = Object.fromEntries(records)
  }
  const document = {
    unit: { name, version: state.version },
    global: state.global,
    tables,
  }
  return `${JSON.stringify(document, null, 2)}\n`
}

/**
 * Parse file content into unit state, validating shape and version.
 * @param text - Raw file content.
 * @param descriptor - Expected identity; version mismatch rejects.
 * @returns the parsed state.
 */
export function parse(text: string, descriptor: KvUnitDescriptor): UnitState {
  let document: unknown
  try {
    document = JSON.parse(text)
  } catch (error) {
    throw new StorageError('malformed-medium', `unit '${descriptor.name}': file is not valid JSON`, { cause: error })
  }
  if (typeof document !== 'object' || document === null) {
    throw new StorageError('malformed-medium', `unit '${descriptor.name}': file is not a JSON object`)
  }
  const { unit, global: globalValue, tables } = document as Record<string, unknown>
  if (
    typeof unit !== 'object' || unit === null ||
    (unit as Record<string, unknown>)['name'] !== descriptor.name ||
    typeof (unit as Record<string, unknown>)['version'] !== 'number'
  ) {
    throw new StorageError('malformed-medium', `unit '${descriptor.name}': missing or foreign unit header`)
  }
  const version = (unit as Record<string, unknown>)['version'] as number
  if (version !== descriptor.version) {
    throw new StorageError(
      'version-mismatch',
      `unit '${descriptor.name}': stored version ${version} != expected ${descriptor.version}`,
    )
  }
  if (typeof tables !== 'object' || tables === null) {
    throw new StorageError('malformed-medium', `unit '${descriptor.name}': tables is not an object`)
  }
  const state: UnitState = { version, global: globalValue ?? null, tables: new Map() }
  for (const table of descriptor.tables) {
    const records = (tables as Record<string, unknown>)[table]
    if (records === undefined) {
      state.tables.set(table, new Map())
      continue
    }
    if (typeof records !== 'object' || records === null || Array.isArray(records)) {
      throw new StorageError('malformed-medium', `unit '${descriptor.name}': table '${table}' is not an object`)
    }
    state.tables.set(table, new Map(Object.entries(records as Record<string, unknown>)))
  }
  return state
}
