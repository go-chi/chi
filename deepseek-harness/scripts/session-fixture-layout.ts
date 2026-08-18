/** Canonical packed-row layout helpers for repository session fixtures. */

import { deepStrictEqual } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { decodeStorageRecord, packChunkRuns, type SessionEvent } from '@deepseek-ai/dsh-session'

/** One repository session fixture and its canonical packed representation. */
export interface SessionFixtureLayout {
  /** Repository-relative path with `/` separators. */
  path: string
  /** Current fixture bytes decoded as UTF-8. */
  source: string
  /** Canonical packed fixture bytes. */
  canonical: string
}

interface RecordLine {
  line: number
  text: string
}

function recordLines(content: string): RecordLine[] {
  return content.split(/\r?\n/).flatMap((text, index) => (
    text.trim().length === 0 ? [] : [{ line: index + 1, text }]
  ))
}

function parseRecord(line: RecordLine, label: string): unknown {
  try {
    return JSON.parse(line.text) as unknown
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`${label}:${line.line}: invalid JSON: ${detail}`, { cause: error })
  }
}

function isSessionHeader(value: unknown): boolean {
  return value !== null && typeof value === 'object' && (value as { type?: unknown }).type === 'session'
}

function decodeBody(lines: readonly RecordLine[], label: string): SessionEvent[] {
  return lines.flatMap((line) => {
    const record = parseRecord(line, label)
    try {
      return decodeStorageRecord(record)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`${label}:${line.line}: invalid session storage record: ${detail}`, { cause: error })
    }
  })
}

function renderFixture(headerLine: string, events: readonly SessionEvent[]): string {
  return [
    headerLine,
    ...packChunkRuns(events).map(record => JSON.stringify(record)),
    '',
  ].join('\n')
}

/**
 * Canonicalize one JSONL document when its first record is a session header.
 * The header line remains byte-identical; body records decode to logical events
 * and re-encode with {@link packChunkRuns}. Non-session JSONL returns undefined.
 *
 * @param content - JSONL source text.
 * @param label - path-like diagnostic label.
 * @returns Canonical text for a session fixture, otherwise undefined.
 */
export function canonicalSessionFixture(content: string, label = '<session-fixture>'): string | undefined {
  const lines = recordLines(content)
  const header = lines[0]
  if (header === undefined) return undefined

  let headerValue: unknown
  try {
    headerValue = JSON.parse(header.text) as unknown
  } catch {
    return undefined
  }
  if (!isSessionHeader(headerValue)) return undefined

  const events = decodeBody(lines.slice(1), label)
  const canonical = renderFixture(header.text, events)
  const canonicalLines = recordLines(canonical)
  const decoded = decodeBody(canonicalLines.slice(1), label)
  try {
    deepStrictEqual(decoded, events)
  } catch (error) {
    throw new Error(`${label}: packed rewrite changed the decoded event stream`, { cause: error })
  }
  if (renderFixture(header.text, decoded) !== canonical) {
    throw new Error(`${label}: packed rewrite is not idempotent`)
  }
  return canonical
}

/**
 * Discover tracked and unignored untracked JSONL files through Git.
 *
 * @param root - repository root.
 * @returns Stable repository-relative paths.
 */
function discoverJsonlFiles(root: string): string[] {
  return execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '*.jsonl'],
    { cwd: root, encoding: 'utf8' },
  ).split('\0')
    .filter(path => path.length > 0 && existsSync(resolve(root, path)))
    .sort()
}

/**
 * Inspect every repository JSONL whose first record is a session header.
 *
 * @param root - repository root.
 * @returns Session fixtures with current and canonical text.
 */
export function inspectSessionFixtureLayouts(root: string): SessionFixtureLayout[] {
  return discoverJsonlFiles(root).flatMap((path) => {
    const source = readFileSync(resolve(root, path), 'utf8')
    const canonical = canonicalSessionFixture(source, path)
    return canonical === undefined ? [] : [{ path, source, canonical }]
  })
}
