import { describe, expect, it } from 'vitest'
import { decodeStorageRecord, type SessionEvent } from '@deepseek-ai/dsh-session'
import { canonicalSessionFixture } from './session-fixture-layout.ts'

const HEADER = '  {"type":"session","version":0,"id":"fixture","createdAt":1,"delegationDepth":0}  '

function chunkRun(): SessionEvent[] {
  return Array.from({ length: 4 }, (_, index) => ({
    type: 'assistant/chunk',
    seq: index,
    time: 10 + index,
    data: {
      turn: 1,
      step: 1,
      chunk: { type: 'text-delta', index: 0, text: `part-${index}` },
    },
  }))
}

function unpackedFixture(): string {
  return [HEADER, ...chunkRun().map(event => JSON.stringify(event)), ''].join('\n')
}

function decodedBody(content: string): SessionEvent[] {
  return content.trimEnd().split('\n').slice(1)
    .flatMap(line => decodeStorageRecord(JSON.parse(line) as unknown))
}

describe('canonicalSessionFixture', () => {
  it('preserves the header line and packs an unpacked event run losslessly', () => {
    const canonical = canonicalSessionFixture(unpackedFixture(), 'fixture.jsonl')
    expect(canonical).toBeDefined()
    expect(canonical?.split('\n')[0]).toBe(HEADER)
    expect(JSON.parse(canonical?.split('\n')[1] ?? '{}')).toMatchObject({ type: 'text-chunks' })
    expect(decodedBody(canonical ?? '')).toStrictEqual(chunkRun())
  })

  it('ignores JSONL whose first record is not a session header', () => {
    expect(canonicalSessionFixture('{"type":"session_event"}\n{"value":1}\n')).toBeUndefined()
  })

  it('is idempotent for an already packed fixture', () => {
    const packed = canonicalSessionFixture(unpackedFixture())
    expect(packed).toBeDefined()
    expect(canonicalSessionFixture(packed ?? '')).toBe(packed)
  })

  it('fails loud on malformed records after a session header', () => {
    expect(() => canonicalSessionFixture(`${HEADER}\n{not-json}\n`, 'broken.jsonl'))
      .toThrow(/broken\.jsonl:2: invalid JSON/)
  })

  it('labels malformed packed rows with the fixture path and line', () => {
    expect(() => canonicalSessionFixture(`${HEADER}\n{"type":"text-chunks"}\n`, 'broken.jsonl'))
      .toThrow(/broken\.jsonl:2: invalid session storage record: malformed text-chunks storage row/)
  })
})
