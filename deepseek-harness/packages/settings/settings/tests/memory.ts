/**
 * In-memory settings provider fixture: the smallest real subclass of the Service Definition,
 * used by the base-class behavior suite in place of a file- or network-backed
 * provider. Kept in `tests/` because production providers live in their own
 * packages.
 */

import { SettingsProvider, type SettingsNamespace } from '../src/index.ts'

/** In-memory provider exposing the protected provider hooks to tests. */
export class MemorySettings extends SettingsProvider {
  /** Raw document the provider "storage" currently holds. */
  doc: Record<string, unknown>
  /** Every persist() call observed, in order. */
  persisted: Array<{ ns: SettingsNamespace; section: Record<string, unknown> }> = []
  /** When false, update() must reject before reaching persist(). */
  writableFlag: boolean

  /** Artificial persist latency so tests can interleave concurrent updates. */
  persistDelayMs: number

  constructor(ctx: ConstructorParameters<typeof SettingsProvider>[0], options?: {
    doc?: Record<string, unknown>
    writable?: boolean
    persistDelayMs?: number
  }) {
    super(ctx)
    this.doc = structuredClone(options?.doc ?? {})
    this.writableFlag = options?.writable ?? true
    this.persistDelayMs = options?.persistDelayMs ?? 0
  }

  get writable(): boolean {
    return this.writableFlag
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected async persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    if (this.persistDelayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, this.persistDelayMs))
    }
    this.persisted.push({ ns, section: structuredClone(section) })
    this.doc[ns] = structuredClone(section)
  }

  /** Simulate an external storage change reaching the provider. */
  pushExternal(doc: Record<string, unknown>): void {
    this.doc = structuredClone(doc)
    this.publish(structuredClone(doc))
  }
}
