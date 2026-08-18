/**
 * Domain declaration vocabulary. A spec object is the single source of a
 * domain's identity, layout, and record schemas: the owning package defines
 * it once with {@link defineDomain} and both the type surface and the runtime
 * (validation, descriptor projection) derive from it. Record schemas are zod
 * (`z.infer` keeps types un-duplicated and the same schemas later project to
 * RPC wire schemas); plugin `Config` stays schemastery.
 * @module @deepseek-ai/dsh-storage-domain/src/spec
 */

import type { ZodType } from 'zod'
import { UNIT_NAME_RE, type KvUnitDescriptor } from '@deepseek-ai/dsh-storage'

/** Global singleton declaration: schema plus the value used before the first write. */
export interface DomainGlobalSpec<G> {
  /** Validates the stored global at the durable boundary. */
  readonly schema: ZodType<G>
  /** Value served when the medium holds no global yet; not written until the first `set`. */
  readonly initial: G
}

/**
 * One table declaration. `K` is a phantom key type (typically a branded
 * string) carried for compile-time projection only; keys are plain strings on
 * the medium.
 */
export interface DomainTableSpec<K extends string = string, V = unknown> {
  /** Validates every stored record at the durable boundary. */
  readonly valueSchema: ZodType<V>
  /** Phantom carrier for the key type; never present at runtime. */
  readonly __key?: K
}

/** Static declaration of one domain: identity, version, and record layout. */
export interface DomainSpec {
  /** Domain name; must match `UNIT_NAME_RE` (doubles as the backend unit name). */
  readonly name: string
  /** Domain format version; a medium stamped with a different version rejects at open. */
  readonly version: number
  /** Optional global singleton slot. */
  readonly global?: DomainGlobalSpec<unknown>
  /** Table declarations keyed by table name; each name must match `UNIT_NAME_RE`. */
  readonly tables: Record<string, DomainTableSpec>
}

/** Key type of one declared table, recovered from its phantom carrier. */
export type TableKeyOf<S extends DomainSpec, N extends keyof S['tables']> =
  S['tables'][N] extends DomainTableSpec<infer K> ? K : never

/** Value type of one declared table. */
export type TableValueOf<S extends DomainSpec, N extends keyof S['tables']> =
  S['tables'][N] extends DomainTableSpec<string, infer V> ? V : never

/** Global value type of a spec; `never` when the spec declares no global. */
export type GlobalValueOf<S extends DomainSpec> =
  S['global'] extends DomainGlobalSpec<infer G> ? G : never

/**
 * Declare one table.
 * @param schema - zod schema validating every stored record of this table.
 * @returns the table declaration, key-typed by `K`.
 */
export function domainTable<K extends string, V>(schema: ZodType<V>): DomainTableSpec<K, V> {
  return { valueSchema: schema }
}

/**
 * Identity helper that pins a spec's literal types and validates its fields.
 * Misconfiguration fails loud at the owning package's module load, before any
 * medium is touched: a domain or table name outside `UNIT_NAME_RE`, a version
 * that is not a non-negative integer, or a global schema that accepts `null`
 * all throw. The `null` rejection guards round-tripping: backends store the
 * global as opaque JSON with `null` as the "never written" sentinel, so a
 * nullable global would be indistinguishable from an absent one on reopen
 * (a stored `null` silently reverts to `initial`).
 * @param spec - The domain declaration.
 * @returns the same spec, narrowed to its literal type.
 */
export function defineDomain<S extends DomainSpec>(spec: S): S {
  if (!UNIT_NAME_RE.test(spec.name)) {
    throw new Error(`domain name '${spec.name}' must match ${UNIT_NAME_RE}`)
  }
  if (!Number.isInteger(spec.version) || spec.version < 0) {
    throw new Error(`domain '${spec.name}' version must be a non-negative integer, got ${spec.version}`)
  }
  for (const table of Object.keys(spec.tables)) {
    if (!UNIT_NAME_RE.test(table)) {
      throw new Error(`domain '${spec.name}' table name '${table}' must match ${UNIT_NAME_RE}`)
    }
  }
  if (spec.global !== undefined && spec.global.schema.safeParse(null).success) {
    throw new Error(
      `domain '${spec.name}' global schema must not accept null: `
      + 'null is the medium\'s "never written" sentinel, so a stored null could not round-trip',
    )
  }
  return spec
}

/**
 * Project a spec onto the backend-facing unit descriptor.
 * @param spec - The domain declaration.
 * @returns the descriptor handed to `KvFacet.open`.
 */
export function descriptorOf(spec: DomainSpec): KvUnitDescriptor {
  return {
    name: spec.name,
    version: spec.version,
    tables: Object.keys(spec.tables),
    hasGlobal: spec.global !== undefined,
  }
}
