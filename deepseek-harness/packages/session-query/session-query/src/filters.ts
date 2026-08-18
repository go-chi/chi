/** Pure provider-independent predicates for logical sessions and event text. */

import type {
  SessionEventResultFilter,
  SessionEventSearchDocument,
  SessionRecord,
  SessionResultFilter,
  SessionResultRange,
} from './types.ts'
import { SessionQueryError } from './config.ts'

/**
 * Apply ANDed logical-session filters while preserving input order.
 * @param records - detached logical-session records to inspect.
 * @param filters - clauses whose list values are ORed within each clause.
 * @returns records accepted by every clause.
 */
export function filterSessionResults<T extends SessionRecord>(
  records: readonly T[],
  filters: readonly SessionResultFilter[] = [],
): T[] {
  const predicates = filters.map(sessionPredicate)
  return records.filter(record => predicates.every(predicate => predicate(record)))
}

/**
 * Apply ANDed event filters to extracted semantic documents.
 * @param documents - semantic documents produced by {@link buildSessionEventSearchDocuments}.
 * @param filters - metadata and literal-text predicates.
 * @returns documents accepted by every clause, in input order.
 */
export function filterSessionEventDocuments<T extends SessionEventSearchDocument>(
  documents: readonly T[],
  filters: readonly SessionEventResultFilter[] = [],
): T[] {
  const predicates = filters.map(eventPredicate)
  return documents.filter(document => predicates.every(predicate => predicate(document)))
}

/**
 * Copy and validate logical-session filters before an asynchronous boundary.
 * @param filters - caller-owned clauses to materialize.
 * @returns detached validated clauses.
 */
export function materializeSessionResultFilters(
  filters: readonly SessionResultFilter[],
): SessionResultFilter[] {
  assertArray(filters)
  return filters.map((filter) => {
    switch (filter.kind) {
      case 'id':
        return { kind: filter.kind, values: copyStrings(filter.kind, filter.values) }
      case 'cwd':
        return { kind: filter.kind, values: copyNullableStrings(filter.kind, filter.values) }
      case 'created-at':
        return copyRange(filter.kind, filter)
      case 'parent':
        return { kind: filter.kind, values: copyNullableStrings(filter.kind, filter.values) }
      case 'availability': {
        const values = copyStrings(filter.kind, filter.values)
        assertAllowedValues(filter.kind, values, ['live', 'persisted'])
        return { kind: filter.kind, values }
      }
      default:
        return unknownFilter(filter)
    }
  })
}

/**
 * Copy and validate event filters before an asynchronous boundary.
 * @param filters - caller-owned clauses to materialize.
 * @returns detached validated clauses.
 */
export function materializeSessionEventResultFilters(
  filters: readonly SessionEventResultFilter[],
): SessionEventResultFilter[] {
  assertArray(filters)
  return filters.map((filter) => {
    switch (filter.kind) {
      case 'seq':
      case 'time':
        return copyRange(filter.kind, filter)
      case 'type':
        return { kind: filter.kind, values: copyStrings(filter.kind, filter.values) }
      case 'surface': {
        const values = copyStrings(filter.kind, filter.values)
        assertAllowedValues(filter.kind, values, ['current', 'shadowed', 'log-only'])
        return { kind: filter.kind, values }
      }
      case 'text':
        if (typeof filter.text !== 'string') throw invalidFilter('text filter text must be a string')
        return { kind: filter.kind, text: filter.text }
      default:
        return unknownFilter(filter)
    }
  })
}

/**
 * Compile a literal case-insensitive, whitespace-flexible semantic-text match.
 * @param text - caller-provided literal text.
 * @returns Unicode-aware regular expression safe from regex injection.
 */
export function compileSessionTextFilter(text: string): RegExp {
  const trimmed = text.trim()
  if (trimmed.length === 0) {
    throw new SessionQueryError(
      'session text filter must contain non-whitespace text',
      'SESSION_QUERY_INVALID_FILTER',
    )
  }
  const pattern = trimmed
    .split(/\s+/u)
    .map(part => part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
    .join('\\s+')
  return new RegExp(pattern, 'iu')
}

function sessionPredicate(filter: SessionResultFilter): (record: SessionRecord) => boolean {
  switch (filter.kind) {
    case 'id':
      return record => filter.values.includes(record.header.id)
    case 'cwd':
      return record => filter.values.includes(record.header.cwd ?? null)
    case 'created-at': {
      const range = validateRange(filter.kind, filter)
      return record => matchesRange(record.header.createdAt, range)
    }
    case 'parent':
      return record => filter.values.includes(record.header.parentSession ?? null)
    case 'availability':
      assertAllowedValues(filter.kind, filter.values, ['live', 'persisted'])
      return record => filter.values.some(value => value === 'live' ? record.live : record.persisted)
    default:
      return unknownFilter(filter)
  }
}

function eventPredicate(filter: SessionEventResultFilter): (document: SessionEventSearchDocument) => boolean {
  switch (filter.kind) {
    case 'seq': {
      const range = validateRange(filter.kind, filter)
      return document => matchesRange(document.seq, range)
    }
    case 'time': {
      const range = validateRange(filter.kind, filter)
      return document => matchesRange(document.time, range)
    }
    case 'type':
      return document => filter.values.includes(document.type)
    case 'surface':
      assertAllowedValues(filter.kind, filter.values, ['current', 'shadowed', 'log-only'])
      return document => filter.values.includes(document.surface)
    case 'text': {
      const pattern = compileSessionTextFilter(filter.text)
      return document => pattern.test(document.text)
    }
    default:
      return unknownFilter(filter)
  }
}

function copyStrings<T extends string>(name: string, values: readonly T[]): T[] {
  if (!isRuntimeArray(values) || values.some(value => typeof value !== 'string')) {
    throw invalidFilter(`${name} filter values must be an array of strings`)
  }
  return [...values]
}

function assertArray(value: unknown): void {
  if (!Array.isArray(value)) throw invalidFilter('filters must be an array')
}

function copyNullableStrings<T extends string>(name: string, values: readonly (T | null)[]): Array<T | null> {
  if (!isRuntimeArray(values) || values.some(value => value !== null && typeof value !== 'string')) {
    throw invalidFilter(`${name} filter values must be an array of strings or null`)
  }
  return [...values]
}

function copyRange<K extends 'created-at' | 'seq' | 'time'>(
  kind: K,
  range: SessionResultRange,
): { kind: K } & SessionResultRange {
  const copy = {
    kind,
    ...range.from === undefined ? {} : { from: range.from },
    ...range.to === undefined ? {} : { to: range.to },
  }
  validateRange(kind, copy)
  return copy
}

function unknownFilter(filter: never): never {
  const kind = (filter as { kind?: unknown }).kind
  throw invalidFilter(`unknown filter kind ${typeof kind === 'string' ? `"${kind}"` : '(missing)'}`)
}

function assertAllowedValues(
  name: string,
  values: readonly string[],
  allowed: readonly string[],
): void {
  for (const value of values) {
    if (!allowed.includes(value)) {
      throw new SessionQueryError(
        `session ${name} filter contains unknown value "${value}"`,
        'SESSION_QUERY_INVALID_FILTER',
      )
    }
  }
}

function validateRange(name: string, range: SessionResultRange): SessionResultRange {
  if (range.from !== undefined && !Number.isFinite(range.from)) {
    throw invalidRange(name, 'from must be finite')
  }
  if (range.to !== undefined && !Number.isFinite(range.to)) {
    throw invalidRange(name, 'to must be finite')
  }
  if (range.from !== undefined && range.to !== undefined && range.from > range.to) {
    throw invalidRange(name, 'from must be less than or equal to to')
  }
  return range
}

function matchesRange(value: number, range: SessionResultRange): boolean {
  return (range.from === undefined || value >= range.from)
    && (range.to === undefined || value <= range.to)
}

function invalidRange(name: string, detail: string): SessionQueryError {
  return invalidFilter(`${name} filter ${detail}`)
}

function invalidFilter(detail: string): SessionQueryError {
  return new SessionQueryError(`session ${detail}`, 'SESSION_QUERY_INVALID_FILTER')
}

function isRuntimeArray(value: unknown): boolean {
  return Array.isArray(value)
}
