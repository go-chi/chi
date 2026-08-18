import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createScope, scopeOf } from '@deepseek-ai/dsh-scope'
import type { Scope, ScopeKey } from '@deepseek-ai/dsh-scope'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'

async function mount(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  return ctx
}

async function mintScope(ctx: Context, name: string): Promise<Scope> {
  let scope!: Scope
  // The scoped context resolves services through the MINTING plugin's
  // dependency chain — the minter must inject what scope holders will reach.
  await ctx.plugin(Object.assign((inner: Context) => { scope = createScope(inner, { name }) },
    { inject: ['sessions'] }))
  return scope
}

/** The key a test scope was minted with. */
function keyOf(scope: Scope): ScopeKey {

  return scopeOf(scope.ctx)!
}

describe('session dispatch carriers', () => {
  it('a session entered through a scoped context dispatches its events in that scope', async () => {
    const ctx = await mount()
    const scope = await mintScope(ctx, 'owner')
    const otherScope = await mintScope(ctx, 'other')

    const heard: string[] = []
    ctx.on('session/event', (_session, event) => void heard.push(`global:${event.type}`))
    scope.ctx.on('session/event', (_session, event) => void heard.push(`owner:${event.type}`))
    otherScope.ctx.on('session/event', (_session, event) => void heard.push(`other:${event.type}`))
    scope.ctx.on('session/created', session => void heard.push(`owner-created:${session.id}`))
    otherScope.ctx.on('session/created', session => void heard.push(`other-created:${session.id}`))

    const session = scope.ctx.sessions.create()
    session.append('turn/start', { turn: 1 })

    expect(heard).toEqual([
      `owner-created:${session.id}`,
      'global:turn/start',
      'owner:turn/start',
    ])
  })

  it('a bare session dispatches subject-less: scoped listeners never hear it', async () => {
    const ctx = await mount()
    const scope = await mintScope(ctx, 'owner')
    const heard: string[] = []
    ctx.on('session/event', (_s, event) => void heard.push(`global:${event.type}`))
    scope.ctx.on('session/event', (_s, event) => void heard.push(`owner:${event.type}`))

    const bare = ctx.sessions.create()
    bare.append('turn/start', { turn: 1 })
    expect(heard).toEqual(['global:turn/start'])
  })

  it('reuses the captured owner carrier for the paired disposal notification', async () => {
    const ctx = await mount()
    const owner = await mintScope(ctx, 'owner')
    const other = await mintScope(ctx, 'other')
    const heard: string[] = []
    ctx.on('session/disposed', (session) => { heard.push(`global:${session.id}`) })
    owner.ctx.on('session/disposed', (session) => { heard.push(`owner:${session.id}`) })
    other.ctx.on('session/disposed', (session) => { heard.push(`other:${session.id}`) })

    const session = owner.ctx.sessions.prepare()
    const detach = owner.ctx.sessions.enter(session)
    owner.ctx.sessions.announce(session)
    detach()

    expect(heard).toEqual([`global:${session.id}`, `owner:${session.id}`])
  })
})

describe('sessions.flush()', () => {
  it('allows an ordinary flush with no listeners', async () => {
    const ctx = await mount()
    const session = ctx.sessions.create()

    await expect(ctx.sessions.flush(session)).resolves.toBe(false)
  })

  it('reports a participating listener after it succeeds', async () => {
    const ctx = await mount()
    const session = ctx.sessions.create()
    const flushed: Session[] = []
    ctx.on('session/flush', current => void flushed.push(current))

    await expect(ctx.sessions.flush(session)).resolves.toBe(true)

    expect(flushed).toEqual([session])
  })

  it('dispatches session/flush with the owning carrier and awaits all listeners', async () => {
    const ctx = await mount()
    const scope = await mintScope(ctx, 'owner')
    const flushed: string[] = []
    ctx.on('session/flush', async (session: Session) => {
      await Promise.resolve()
      flushed.push(`global:${session.id}`)
    })
    scope.ctx.on('session/flush', (session: Session) => void flushed.push(`owner:${session.id}`))

    const owned = scope.ctx.sessions.create()
    const bare = ctx.sessions.create()
    await ctx.sessions.flush(owned)
    await ctx.sessions.flush(bare)

    // Parallel dispatch: listener completion order is unspecified (the global
    // listener awaits a microtask) — assert set membership per flush instead.
    expect(flushed.slice(0, 2).sort()).toEqual([`global:${owned.id}`, `owner:${owned.id}`])
    expect(flushed.slice(2)).toEqual([`global:${bare.id}`])
  })

  it('propagates a rejecting flush listener (the caller owns the failure policy)', async () => {
    const ctx = await mount()
    ctx.on('session/flush', () => Promise.reject(new Error('disk full')))
    const session = ctx.sessions.create()
    await expect(ctx.sessions.flush(session)).rejects.toThrow('disk full')
  })

  it('does not let a synchronous flush failure starve later listeners', async () => {
    const ctx = await mount()
    const flushed: Session[] = []
    ctx.on('session/flush', () => { throw new Error('disk full') })
    ctx.on('session/flush', (session) => { flushed.push(session) })
    const session = ctx.sessions.create()

    await expect(ctx.sessions.flush(session)).rejects.toThrow('disk full')
    expect(flushed).toEqual([session])
  })

  it('waits for slower flush listeners before reporting another listener failure', async () => {
    const ctx = await mount()
    const gate = Promise.withResolvers<undefined>()
    let slowStarted = false
    let settled = false
    ctx.on('session/flush', () => Promise.reject(new Error('disk full')))
    ctx.on('session/flush', () => {
      slowStarted = true
      return gate.promise
    })
    const session = ctx.sessions.create()

    const flushing = ctx.sessions.flush(session)
    void flushing.finally(() => { settled = true }).catch(() => undefined)
    await Promise.resolve()
    expect(slowStarted).toBe(true)
    expect(settled).toBe(false)

    gate.resolve(undefined)
    await expect(flushing).rejects.toThrow('disk full')
    expect(settled).toBe(true)
  })

  it('rejects a never-entered session instead of inventing a carrier', async () => {
    const ctx = await mount()
    const scope = await mintScope(ctx, 'owner')
    const flushed: string[] = []
    ctx.on('session/flush', (session: Session) => void flushed.push(`global:${session.id}`))
    scope.ctx.on('session/flush', (session: Session) => void flushed.push(`owner:${session.id}`))

    const prepared = ctx.sessions.prepare()
    await expect(ctx.sessions.flush(prepared)).rejects.toThrow(/not live/)
    expect(flushed).toEqual([])
  })

  it('clears a detached carrier and rejects stale flushes', async () => {
    const ctx = await mount()
    const scope = await mintScope(ctx, 'owner')
    const flushed: string[] = []
    ctx.on('session/flush', (session: Session) => void flushed.push(`global:${session.id}`))
    scope.ctx.on('session/flush', (session: Session) => void flushed.push(`owner:${session.id}`))

    const session = scope.ctx.sessions.prepare()
    const detach = scope.ctx.sessions.enter(session)
    await ctx.sessions.flush(session)
    expect(flushed.sort()).toEqual([`global:${session.id}`, `owner:${session.id}`])

    detach()
    await expect(ctx.sessions.flush(session)).rejects.toThrow(/not live/)
    expect(flushed).toHaveLength(2)
  })

  it('keyOf sanity: distinct scopes carry distinct keys', async () => {
    const ctx = await mount()
    const a = await mintScope(ctx, 'a')
    const b = await mintScope(ctx, 'b')
    expect(keyOf(a)).not.toBe(keyOf(b))
  })
})
