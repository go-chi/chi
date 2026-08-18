/**
 * Unit tests for the search-card presentation layer (`src/presentation.ts`): the
 * canonical value → `presentationMeta` projections (`grepSearchMeta`,
 * `globSearchMeta`, `groupMatchesByFile`) and the defensive `meta` → view
 * narrowing (`searchViewFromMeta`). These pin the by-file grouping, the
 * `truncated`/`total` honesty over already-retained input, the serialized-meta
 * byte cap, and the malformed-metadata fallback a replayed or hand-edited log can
 * deliver.
 */

import { describe, expect, it } from 'vitest'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import {
  globSearchMeta,
  grepSearchMeta,
  groupMatchesByFile,
  searchViewFromMeta,
} from '../src/presentation.ts'
import type { GrepMatch } from '../src/search-core.ts'
import { retainGlobPaths, retainGrepMatches } from '../src/search-core.ts'

const match = (path: string, lineNumber: number, line: string): GrepMatch => ({ path, lineNumber, line })

/** A byte cap large enough that no test payload here is meta-capped. */
const WIDE = 1_000_000

describe('groupMatchesByFile', () => {
  it('groups matches by first-seen file order, keeping line/lineNumber only', () => {
    expect(groupMatchesByFile([
      match('b.ts', 2, 'x'),
      match('a.ts', 1, 'y'),
      match('b.ts', 5, 'z'),
    ])).toEqual([
      { path: 'b.ts', matches: [{ lineNumber: 2, line: 'x' }, { lineNumber: 5, line: 'z' }] },
      { path: 'a.ts', matches: [{ lineNumber: 1, line: 'y' }] },
    ])
  })

  it('returns an empty list for no matches', () => {
    expect(groupMatchesByFile([])).toEqual([])
  })
})

describe('grepSearchMeta', () => {
  it('projects grouped matches with total and a false truncation flag within the cap', () => {
    const meta = grepSearchMeta(retainGrepMatches([match('a.ts', 1, 'one'), match('a.ts', 2, 'two')], 10, 2000), WIDE)
    expect(meta).toEqual({
      shape: 'matches',
      files: [{ path: 'a.ts', matches: [{ lineNumber: 1, line: 'one' }, { lineNumber: 2, line: 'two' }] }],
      truncated: false,
      total: 2,
    })
  })

  it('reports the pre-cap total and truncation from the shared retention pass', () => {
    const meta = grepSearchMeta(retainGrepMatches([match('a.ts', 1, 'one'), match('a.ts', 2, 'two'), match('b.ts', 3, 'three')], 2, 2000), WIDE)
    expect(meta).toEqual({
      shape: 'matches',
      files: [{ path: 'a.ts', matches: [{ lineNumber: 1, line: 'one' }, { lineNumber: 2, line: 'two' }] }],
      truncated: true,
      total: 3,
    })
  })

  it('carries the per-line preview budget (UTF-8 boundary) the retention pass applied', () => {
    const meta = grepSearchMeta(retainGrepMatches([match('a.txt', 1, 'aéaéaéaé')], 10, 7), WIDE)
    expect(meta).toMatchObject({ shape: 'matches', files: [{ path: 'a.txt', matches: [{ lineNumber: 1, line: 'aéaéa (line truncated)' }] }] })
  })

  it('drops trailing file groups until the serialized meta fits the byte cap, marking it truncated', () => {
    const retained = retainGrepMatches(
      [match('a.ts', 1, 'x'.repeat(60)), match('b.ts', 2, 'y'.repeat(60)), match('c.ts', 3, 'z'.repeat(60))],
      10,
      2000,
    )
    // One 60-byte group serializes to ~110 bytes; a 260-byte cap holds two, not three.
    const meta = grepSearchMeta(retained, 260)
    expect(meta.shape).toBe('matches')
    if (meta.shape !== 'matches') throw new Error('unreachable')
    expect(meta.truncated).toBe(true)
    expect(meta.total).toBe(3)
    expect(meta.files.length).toBeLessThan(3)
    expect(Buffer.byteLength(JSON.stringify(meta), 'utf8')).toBeLessThanOrEqual(260)
  })

  it('keeps a single oversized group rather than emit an empty card', () => {
    const meta = grepSearchMeta(retainGrepMatches([match('a.ts', 1, 'x'.repeat(500))], 10, 2000), 50)
    expect(meta.shape).toBe('matches')
    if (meta.shape !== 'matches') throw new Error('unreachable')
    expect(meta.files).toHaveLength(1)
    expect(meta.truncated).toBe(true)
  })
})

describe('globSearchMeta', () => {
  it('projects the path list with total and a false truncation flag within the cap', () => {
    expect(globSearchMeta(retainGlobPaths(['a.ts', 'b.ts'], 10), WIDE)).toEqual({ shape: 'paths', paths: ['a.ts', 'b.ts'], truncated: false, total: 2 })
  })

  it('reports the pre-cap total and truncation from the shared retention pass', () => {
    expect(globSearchMeta(retainGlobPaths(['a.ts', 'b.ts', 'c.ts'], 2), WIDE)).toEqual({ shape: 'paths', paths: ['a.ts', 'b.ts'], truncated: true, total: 3 })
  })

  it('drops trailing paths until the serialized meta fits the byte cap, marking it truncated', () => {
    const retained = retainGlobPaths([`${'a'.repeat(100)}.ts`, `${'b'.repeat(100)}.ts`, `${'c'.repeat(100)}.ts`], 10)
    const meta = globSearchMeta(retained, 180)
    expect(meta.shape).toBe('paths')
    if (meta.shape !== 'paths') throw new Error('unreachable')
    expect(meta.truncated).toBe(true)
    expect(meta.total).toBe(3)
    expect(meta.paths.length).toBeLessThan(3)
    expect(Buffer.byteLength(JSON.stringify(meta), 'utf8')).toBeLessThanOrEqual(180)
  })
})

describe('searchViewFromMeta (defensive narrowing)', () => {
  // The narrowing accepts an opaque JsonValue; a malformed payload is not a
  // statically-valid JsonValue, so route every case through one cast helper that
  // mirrors how a hand-edited/older session log delivers arbitrary shapes.
  const m = (value: unknown): JsonValue | undefined => value as JsonValue | undefined

  it('narrows a well-formed matches payload into a matches view', () => {
    const meta = { shape: 'matches', files: [{ path: 'a.ts', matches: [{ lineNumber: 1, line: 'x' }] }], truncated: true, total: 5 }
    expect(searchViewFromMeta(m(meta))).toEqual({ card: 'search', ...meta })
  })

  it('narrows a well-formed paths payload into a paths view', () => {
    const meta = { shape: 'paths', paths: ['a.ts', 'b.ts'], truncated: false, total: 2 }
    expect(searchViewFromMeta(m(meta))).toEqual({ card: 'search', ...meta })
  })

  it('narrows a zero-result payload into a valid empty card (not a rejected projection)', () => {
    expect(searchViewFromMeta(m({ shape: 'matches', files: [], truncated: false, total: 0 })))
      .toEqual({ card: 'search', shape: 'matches', files: [], truncated: false, total: 0 })
    expect(searchViewFromMeta(m({ shape: 'paths', paths: [], truncated: false, total: 0 })))
      .toEqual({ card: 'search', shape: 'paths', paths: [], truncated: false, total: 0 })
  })

  it('rejects undefined / non-object / array meta', () => {
    expect(searchViewFromMeta(undefined)).toBeUndefined()
    expect(searchViewFromMeta(null)).toBeUndefined()
    expect(searchViewFromMeta(m('nope'))).toBeUndefined()
    expect(searchViewFromMeta(m([]))).toBeUndefined()
  })

  it('rejects a payload with a missing / mistyped truncated or total field', () => {
    expect(searchViewFromMeta(m({ shape: 'paths', paths: [], total: 0 }))).toBeUndefined()
    expect(searchViewFromMeta(m({ shape: 'paths', paths: [], truncated: 'no', total: 0 }))).toBeUndefined()
    expect(searchViewFromMeta(m({ shape: 'paths', paths: [], truncated: false }))).toBeUndefined()
    expect(searchViewFromMeta(m({ shape: 'paths', paths: [], truncated: false, total: '0' }))).toBeUndefined()
  })

  it('rejects an unknown or missing shape discriminant', () => {
    expect(searchViewFromMeta(m({ shape: 'other', truncated: false, total: 0 }))).toBeUndefined()
    expect(searchViewFromMeta(m({ truncated: false, total: 0 }))).toBeUndefined()
  })

  it('rejects a matches payload with a malformed files array', () => {
    const base = { shape: 'matches', truncated: false, total: 1 }
    expect(searchViewFromMeta(m({ ...base, files: 'x' }))).toBeUndefined()
    expect(searchViewFromMeta(m({ ...base, files: [null] }))).toBeUndefined()
    expect(searchViewFromMeta(m({ ...base, files: ['x'] }))).toBeUndefined()
    expect(searchViewFromMeta(m({ ...base, files: [[]] }))).toBeUndefined()
    expect(searchViewFromMeta(m({ ...base, files: [{ path: 1, matches: [] }] }))).toBeUndefined()
    expect(searchViewFromMeta(m({ ...base, files: [{ path: 'a', matches: 'x' }] }))).toBeUndefined()
    expect(searchViewFromMeta(m({ ...base, files: [{ path: 'a', matches: [null] }] }))).toBeUndefined()
    expect(searchViewFromMeta(m({ ...base, files: [{ path: 'a', matches: [{ lineNumber: '1', line: 'x' }] }] }))).toBeUndefined()
    expect(searchViewFromMeta(m({ ...base, files: [{ path: 'a', matches: [{ lineNumber: 1, line: 2 }] }] }))).toBeUndefined()
  })

  it('rejects a paths payload with a non-array or non-string-element paths field', () => {
    const base = { shape: 'paths', truncated: false, total: 1 }
    expect(searchViewFromMeta(m({ ...base, paths: 'x' }))).toBeUndefined()
    expect(searchViewFromMeta(m({ ...base, paths: [1] }))).toBeUndefined()
  })
})
