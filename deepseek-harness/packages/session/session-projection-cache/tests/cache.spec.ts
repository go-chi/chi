/**
 * SessionProjectionCache behavior: mandatory-point writes (turn/end, detach),
 * count/interval throttling between them, fail-soft durability (a failed
 * write logs and stays stale, never throws into the event path), and the
 * cold-read ladder (cached row + readFrom tail + registry restore +
 * write-back; version bump and shrunk-log rows degrade to a full re-read).
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import SessionProjectionCache from '../src/index.ts'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    'cache-test/marks': { marks: string[] }
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'cache-test/mark': { marks: string[] }
  }

  interface OutOfBandSessionEventMap {
    'cache-test/mark': true
  }
}

type MarksState = { marks: string[] } | null
const marksUnit = (stateVersion = 1): ProjectionDefinition<'cache-test/marks', MarksState> => ({
  key: 'cache-test/marks',
  schema: z.object({ marks: z.array(z.string()) }),
  init: () => null,
  apply: (state, event) => (event.type === 'cache-test/mark' ? (event).data : state),
  view: state => state ?? { marks: [] },
  stateVersion,
})

/** A persistence double serving readFrom over a fixed per-id stored log (headers stamp createdAt 0). */
function fakePersistence(logs: Map<string, SessionEvent[]>) {
  const readFrom = vi.fn(async (id: SessionId, fromSeq: number) => {
    const events = logs.get(String(id))
    if (events === undefined) throw new Error(`session "${id}" not found`)
    return {
      meta: { version: 0, id, createdAt: 0 },
      events: events.filter(event => event.seq >= fromSeq),
    }
  })
  return { readFrom }
}

/** Header shape for cachedSnapshot calls (fake logs stamp createdAt 0, no cwd). */
const headerOf = (id: SessionId, createdAt = 0, cwd?: string) =>
  ({ version: 0, id, createdAt, ...cwd === undefined ? {} : { cwd } })

interface HarnessOptions {
  pool?: MemoryMediaPool
  config?: { writeEveryEvents: number; writeIntervalMs: number }
  stateVersion?: number
  logs?: Map<string, SessionEvent[]>
}

const contexts: Context[] = []

async function harness(options: HarnessOptions = {}) {
  const pool = options.pool ?? new MemoryMediaPool()
  const logs = options.logs ?? new Map<string, SessionEvent[]>()
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  ctx.sessionProjections.register(marksUnit(options.stateVersion))
  const persistence = fakePersistence(logs)
  ctx.provide('sessionPersistence', persistence as never)
  const fiber = await ctx.plugin(SessionProjectionCache, options.config ?? { writeEveryEvents: 100, writeIntervalMs: 60_000 })
  return { ctx, pool, logs, fiber, persistence, cache: ctx.sessionProjectionCache }
}

const mark = (session: Session, marks: string[]): SessionEvent =>
  session.append('cache-test/mark', { marks })

const endTurn = (session: Session): SessionEvent =>
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

/** The stored medium record for one session id (undefined = never written). */
function storedRecord(pool: MemoryMediaPool, id: Session['id']) {
  return pool.media.get('session_projcache')?.tables.get('sessions')?.get(String(id)) as
    {
      identity: { createdAt: number; cwd?: string }
      rows: Record<string, { ver: number; seq: number; val: unknown }>
    } | undefined
}

/** The stored medium rows for one session id (undefined = never written). */
function storedRows(pool: MemoryMediaPool, id: Session['id']) {
  return storedRecord(pool, id)?.rows
}

/** Wait until queued fail-soft writes (event-listener fire-and-forget) drain. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

describe('SessionProjectionCache write policy', () => {
  it('writes a durable checkpoint at turn/end (mandatory point)', async () => {
    const { ctx, pool } = await harness()
    const session = ctx.sessions.create(SessionId('turn-end'))
    mark(session, ['a'])
    expect(storedRows(pool, session.id)).toBeUndefined() // throttled: no write yet
    const end = endTurn(session)
    await settle()
    const rows = storedRows(pool, session.id)
    expect(rows?.['cache-test/marks']).toEqual({ ver: 1, seq: end.seq, val: { marks: ['a'] } })
  })

  it('writes at session disposal (detach, the live-to-cold moment)', async () => {
    const { ctx, pool } = await harness()
    // Sessions dispose with their owning fiber: create in a child plugin.
    let session: Session | undefined
    const owner = await ctx.plugin(Object.assign((inner: Context) => {
      session = inner.sessions.create(SessionId('detach'))
    }, { inject: ['sessions'] }))
    if (session === undefined) throw new Error('session was not created')
    mark(session, ['live'])
    await owner.dispose()
    await settle()
    expect(storedRows(pool, session.id)?.['cache-test/marks']?.val).toEqual({ marks: ['live'] })
  })

  it('flushes when the in-turn event count reaches the configured threshold', async () => {
    const { ctx, pool } = await harness({ config: { writeEveryEvents: 3, writeIntervalMs: 60_000 } })
    const session = ctx.sessions.create(SessionId('count'))
    mark(session, ['1'])
    mark(session, ['2'])
    await settle()
    expect(storedRows(pool, session.id)).toBeUndefined()
    mark(session, ['3'])
    await settle()
    expect(storedRows(pool, session.id)?.['cache-test/marks']?.val).toEqual({ marks: ['3'] })
  })

  it('flushes on the configured interval when the count threshold is not reached', async () => {
    vi.useFakeTimers()
    const { ctx, pool } = await harness({ config: { writeEveryEvents: 100, writeIntervalMs: 250 } })
    const session = ctx.sessions.create(SessionId('interval'))
    mark(session, ['slow'])
    await vi.advanceTimersByTimeAsync(249)
    expect(storedRows(pool, session.id)).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(storedRows(pool, session.id)?.['cache-test/marks']?.val).toEqual({ marks: ['slow'] })
  })

  it('write() on a never-dirty session checkpoints directly and rejects a non-JSON unit state', async () => {
    const { ctx, pool } = await harness()
    // Never dirtied: no events — write() still lands the init-derived cut.
    const clean = ctx.sessions.create(SessionId('clean-write'))
    await ctx.sessionProjectionCache.write(clean)
    expect(storedRows(pool, clean.id)?.['cache-test/marks']).toEqual({ ver: 1, seq: -1, val: null })
    // A unit whose state violates the plain-JSON contract fails the write loud.
    ctx.sessionProjections.register({
      key: 'cache-test/marks2' as never,
      schema: { parse: (value: unknown) => value } as never,
      init: () => new Map<string, string>(),
      apply: (state: unknown) => state,
      view: () => null as never,
      stateVersion: 1,
    })
    await expect(ctx.sessionProjectionCache.write(clean)).rejects.toThrow('not losslessly JSON-serializable')
  })

  it('plugin disposal clears armed interval timers and leaves cleaned sessions alone', async () => {
    vi.useFakeTimers()
    const { ctx, pool, fiber } = await harness({ config: { writeEveryEvents: 100, writeIntervalMs: 5000 } })
    const armed = ctx.sessions.create(SessionId('armed'))
    const cleaned = ctx.sessions.create(SessionId('cleaned'))
    mark(armed, ['pending']) // timer armed, no write yet
    mark(cleaned, ['done'])
    endTurn(cleaned) // mandatory write; markClean leaves {pending: 0, timer: undefined} in the map
    await vi.advanceTimersByTimeAsync(0)
    await fiber.dispose()
    // The armed timer died with the plugin: advancing time writes nothing.
    await vi.advanceTimersByTimeAsync(10_000)
    expect(storedRows(pool, armed.id)).toBeUndefined()
  })

  it('contains a durable write failure: logs a warning, event path unharmed, next write self-heals', async () => {
    const { ctx, pool } = await harness()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    const session = ctx.sessions.create(SessionId('fail-soft'))
    mark(session, ['x'])
    pool.failNextWrites = 1
    endTurn(session)
    await settle()
    expect(storedRows(pool, session.id)).toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('turn/end write for "fail-soft" failed'))
    // Self-heal: the next mandatory point writes the current cut.
    mark(session, ['y'])
    endTurn(session)
    await settle()
    expect(storedRows(pool, session.id)?.['cache-test/marks']?.val).toEqual({ marks: ['y'] })
  })
})

describe('SessionProjectionCache cold read', () => {
  const storedLog = (marks: string[][]): SessionEvent[] => {
    const events: SessionEvent[] = [
      { type: 'turn/start', seq: 0, time: 0, data: { turn: 1 } },
    ]
    for (const m of marks) {
      events.push({ type: 'cache-test/mark', seq: events.length, time: events.length, data: { marks: m } })
    }
    events.push({ type: 'turn/end', seq: events.length, time: events.length, data: { turn: 1, reason: { kind: 'completed' } } })
    return events
  }

  /** Pre-seed the medium with one stored checkpoint record (before the domain opens). */
  function seedRow(
    pool: MemoryMediaPool,
    id: string,
    row: { ver: number; seq: number; val: unknown },
    identity: { createdAt: number; cwd?: string } = { createdAt: 0 },
  ): void {
    pool.versions.set('session_projcache', 3)
    pool.media.set('session_projcache', {
      tables: new Map([['sessions', new Map([[id, { identity, rows: { 'cache-test/marks': row } }]])]]),
      global: null,
    })
  }

  it('serves a cold session from the cache row plus a bounded tail read, and writes the refresh back', async () => {
    const pool = new MemoryMediaPool()
    const logs = new Map([['cold', storedLog([['a'], ['a', 'b']])]])
    // A warm-era checkpoint at watermark 1 (only ['a'] folded).
    seedRow(pool, 'cold', { ver: 1, seq: 1, val: { marks: ['a'] } })
    const { cache, persistence, pool: samePool } = await harness({ pool, logs })
    const id = SessionId('cold')
    const snapshot = await cache.coldSnapshot(id)
    expect(snapshot.values['cache-test/marks']).toEqual({ marks: ['a', 'b'] })
    expect(snapshot.asOfSeq).toBe(3)
    // The tail read was bounded by the anchored floor (watermark 1 -> floor 1), not 0.
    expect(persistence.readFrom).toHaveBeenCalledWith(id, 1, undefined)
    // Write-back: the stored row advanced to the served cut.
    expect(storedRows(samePool, id)?.['cache-test/marks'])
      .toEqual({ ver: 1, seq: 3, val: { marks: ['a', 'b'] } })
  })

  it('discards a version-mismatched row and refolds the full log', async () => {
    const pool = new MemoryMediaPool()
    const logs = new Map([['bumped', storedLog([['a']])]])
    seedRow(pool, 'bumped', { ver: 1, seq: 2, val: { marks: ['stale'] } })
    const { cache, persistence } = await harness({ pool, logs, stateVersion: 2 })
    const snapshot = await cache.coldSnapshot(SessionId('bumped'))
    expect(snapshot.values['cache-test/marks']).toEqual({ marks: ['a'] })
    // Mismatch pulls the floor to 0: one full read, no second pass needed.
    expect(persistence.readFrom).toHaveBeenCalledTimes(1)
    expect(persistence.readFrom).toHaveBeenCalledWith(SessionId('bumped'), 0, undefined)
  })

  it('detects a log shrunk below the row watermark and degrades to one full re-read', async () => {
    const pool = new MemoryMediaPool()
    const logs = new Map([['shrunk', storedLog([['a']])]]) // seqs 0..2
    seedRow(pool, 'shrunk', { ver: 1, seq: 9, val: { marks: ['ghost'] } })
    const { cache, persistence } = await harness({ pool, logs })
    const snapshot = await cache.coldSnapshot(SessionId('shrunk'))
    expect(snapshot.values['cache-test/marks']).toEqual({ marks: ['a'] })
    expect(snapshot.asOfSeq).toBe(2)
    // Anchored tail read (floor 9) came back empty -> full re-read from 0.
    expect(persistence.readFrom).toHaveBeenNthCalledWith(1, SessionId('shrunk'), 9, undefined)
    expect(persistence.readFrom).toHaveBeenNthCalledWith(2, SessionId('shrunk'), 0, undefined)
  })

  it('write-back failure is contained: the snapshot is still served', async () => {
    const pool = new MemoryMediaPool()
    const logs = new Map([['soft', storedLog([['a']])]])
    const { ctx, cache } = await harness({ pool, logs })
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    pool.failNextWrites = 1
    const snapshot = await cache.coldSnapshot(SessionId('soft'))
    expect(snapshot.values['cache-test/marks']).toEqual({ marks: ['a'] })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('cold-read write-back for "soft" failed'))
  })

  it('rejects for a session with no persisted log', async () => {
    const { cache } = await harness()
    await expect(cache.coldSnapshot(SessionId('absent'))).rejects.toThrow('not found')
  })

  it('discards a record bound to a different log lifecycle and refolds from the actual log', async () => {
    const pool = new MemoryMediaPool()
    const logs = new Map([['reborn', storedLog([['real']])]]) // stored header stamps createdAt 0
    // A checkpoint from a PRIOR lifecycle of the same id (different createdAt):
    // its rows pass every watermark check, but the identity does not match.
    seedRow(pool, 'reborn', { ver: 1, seq: 2, val: { marks: ['phantom'] } }, { createdAt: 999 })
    const { cache, pool: samePool } = await harness({ pool, logs })
    const snapshot = await cache.coldSnapshot(SessionId('reborn'))
    expect(snapshot.values['cache-test/marks']).toEqual({ marks: ['real'] })
    // The write-back rebinds the record to the actual log's identity.
    expect(storedRecord(samePool, SessionId('reborn'))?.identity).toEqual({ createdAt: 0 })
  })

  it('cachedSnapshot returns undefined when every stored row is version-mismatched', async () => {
    const pool = new MemoryMediaPool()
    seedRow(pool, 'all-stale', { ver: 99, seq: 4, val: { marks: ['old'] } })
    const { cache } = await harness({ pool })
    expect(cache.cachedSnapshot(headerOf(SessionId('all-stale')))).toBeUndefined()
  })

  it('binds identity on cwd too: a matching cwd serves, a moved session does not', async () => {
    const pool = new MemoryMediaPool()
    seedRow(pool, 'homed', { ver: 1, seq: 2, val: { marks: ['w'] } }, { createdAt: 0, cwd: '/work' })
    const { cache } = await harness({ pool })
    const id = SessionId('homed')
    expect(cache.cachedSnapshot(headerOf(id, 0, '/work'))?.values['cache-test/marks']).toEqual({ marks: ['w'] })
    expect(cache.cachedSnapshot(headerOf(id, 0, '/elsewhere'))).toBeUndefined()
    expect(cache.cachedSnapshot(headerOf(id, 0))).toBeUndefined()
  })

  it('dates an empty stored log at -1 in the zero-units topology', async () => {
    const pool = new MemoryMediaPool()
    const logs = new Map([['empty', [] as SessionEvent[]]])
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(Storage)
    ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
    const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
    ctx.storage.mount('domain', facility)
    ctx.provide('storageDomain', facility)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    ctx.provide('sessionPersistence', fakePersistence(logs) as never)
    await ctx.plugin(SessionProjectionCache, { writeEveryEvents: 100, writeIntervalMs: 60_000 })
    await expect(ctx.sessionProjectionCache.coldSnapshot(SessionId('empty')))
      .resolves.toEqual({ asOfSeq: -1, values: {} })
  })

  it('cachedSnapshot serves identity-matching rows with the cut watermark and refuses unrelated ones', async () => {
    const pool = new MemoryMediaPool()
    seedRow(pool, 'listed', { ver: 1, seq: 4, val: { marks: ['t'] } })
    const { cache } = await harness({ pool })
    const id = SessionId('listed')
    // Matching header: values plus the watermark the client seeds under.
    expect(cache.cachedSnapshot(headerOf(id))).toEqual({ asOfSeq: 4, values: { 'cache-test/marks': { marks: ['t'] } } })
    // A recreated id (different createdAt): the record is unrelated — no block.
    expect(cache.cachedSnapshot(headerOf(id, 777))).toBeUndefined()
    // Unknown id: no block.
    expect(cache.cachedSnapshot(headerOf(SessionId('never-cached')))).toBeUndefined()
  })

  it('holds the not-found contract with zero registered units, and dates the empty cut for a present log', async () => {
    // Same composition minus any registered unit: restoreFloor is undefined,
    // yet coldSnapshot must still reject for an absent log (probe read) and
    // serve an empty cut at the stored end for a present one.
    const pool = new MemoryMediaPool()
    const logs = new Map([['bare', storedLog([['a']])]]) // seqs 0..2
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(Storage)
    ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
    const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
    ctx.storage.mount('domain', facility)
    ctx.provide('storageDomain', facility)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    ctx.provide('sessionPersistence', fakePersistence(logs) as never)
    await ctx.plugin(SessionProjectionCache, { writeEveryEvents: 100, writeIntervalMs: 60_000 })
    await expect(ctx.sessionProjectionCache.coldSnapshot(SessionId('absent'))).rejects.toThrow('not found')
    await expect(ctx.sessionProjectionCache.coldSnapshot(SessionId('bare')))
      .resolves.toEqual({ asOfSeq: 2, values: {} })
  })
})
