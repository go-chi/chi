/**
 * The `title` projection unit: mounting the title service beside the
 * projection registry serves the current normalized title (last-wins over
 * session/title events, the same events foldSessionTitle consumes) — null
 * before the first title — through the registry snapshot and the change
 * feed; compositions without the registry are unaffected; unmounting the
 * service removes the key (HMR safety). The bespoke session/title mux frame
 * is untouched by this unit (its retirement is the client value-store
 * migration's concern).
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SessionTitleService from '@deepseek-ai/dsh-session-title'

const CONFIG = { fallbackMaxWords: 8, fallbackMaxBytes: 64, maxTitleBytes: 256 }

async function harness(withTitleService: boolean): Promise<{ ctx: Context; session: Session }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  if (withTitleService) await ctx.plugin(SessionTitleService, CONFIG)
  return { ctx, session: ctx.sessions.create(SessionId('titled')) }
}

/** Append one session/title event directly (the replay-plane shape the unit folds). */
function appendTitle(session: Session, title: string): number {
  return session.append('session/title', { title, messageSeqs: [1], source: { kind: 'fallback' } }).seq
}

describe('title projection unit', () => {
  it('serves null before the first title event', async () => {
    const { ctx, session } = await harness(true)
    const snapshot = ctx.sessionProjections.snapshot(session)
    expect(snapshot.values.title).toBeNull()
  })

  it('serves the latest title last-wins and notifies the change feed with the causing seq', async () => {
    const { ctx, session } = await harness(true)
    const changes: { key: string; value: unknown; seq: number }[] = []
    ctx.sessionProjections.onChanged((_session, key, value, seq) => {
      changes.push({ key, value, seq })
    })
    const firstSeq = appendTitle(session, 'First title')
    const secondSeq = appendTitle(session, 'Second title')
    // Unrelated event: same-reference apply, no notification.
    session.append('turn/start', { turn: 1 })
    expect(changes).toEqual([
      { key: 'title', value: 'First title', seq: firstSeq },
      { key: 'title', value: 'Second title', seq: secondSeq },
    ])
    const snapshot = ctx.sessionProjections.snapshot(session)
    expect(snapshot.values.title).toBe('Second title')
    expect(snapshot.asOfSeq).toBe(session.seq - 1)
  })

  it('folds titles already in the log when the service mounts late (lazy cell build)', async () => {
    const { ctx, session } = await harness(false)
    appendTitle(session, 'Pre-mount title')
    await ctx.plugin(SessionTitleService, CONFIG)
    expect(ctx.sessionProjections.snapshot(session).values.title).toBe('Pre-mount title')
  })

  it('has no title key without the title service, and drops it when the service unloads (HMR safety)', async () => {
    const { ctx, session } = await harness(false)
    expect('title' in ctx.sessionProjections.snapshot(session).values).toBe(false)
    const fiber = await ctx.plugin(SessionTitleService, CONFIG)
    appendTitle(session, 'Ephemeral')
    expect(ctx.sessionProjections.snapshot(session).values.title).toBe('Ephemeral')
    await fiber.dispose()
    expect('title' in ctx.sessionProjections.snapshot(session).values).toBe(false)
  })
})
