/**
 * ui-subagent browser half: source registration (duplicate-name proof) +
 * fiber-teardown removal (HMR safety) against the real InputTriggerService, then
 * the source behavior contract driven directly on the captured source with
 * real ClientSessionContext projections — zero-RPC candidates from the root
 * session list (running children of the projected session, label-contains
 * filtering, childless session → empty), the synchronous lexicon roster,
 * pick → plain-text outcome (the plain-text-reference decision:
 * .agents/notes/implemented/architecture/2026-07-25-web-input-machine-and-slash-pipeline.md),
 * and the reference codec's two
 * projections. Direct driving is deliberate: this spec owns only the
 * source's own contract.
 */
import { Context } from '@deepseek-ai/cordis'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { describe, expect, it } from 'vitest'
import {
  SlotRegistry, type ConversationSnapshot, type SessionId, type SessionListState,
  type SessionSummary, type SubagentAddress,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ComposerChainProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { InputTriggerService } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { ClientSessionContext, InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import {
  SubagentCatalogAction, type SubagentCatalogInjected,
} from '../src/client/SubagentCatalogAction.tsx'
import {
  SubagentReadOnlyComposer, type SubagentReadOnlyMatch,
} from '../src/client/SubagentReadOnlyComposer.tsx'
import { apply, inject } from '../src/client/index.ts'

function summary(partial: Partial<SessionSummary> & { id: SessionId }): SessionSummary {
  return {
    displayTitle: partial.id,
    running: false,
    updatedAt: 0,
    ...partial,
  } as SessionSummary
}

const sid = (id: string) => id as SessionId

/** Fake root sessions face: the list snapshot the source closes over. */
function sessionsWith(sessions: SessionSummary[]) {
  const byId: Record<string, SessionSummary> = {}
  for (const s of sessions) byId[s.id] = s
  const snapshot = { ids: sessions.map(s => s.id), byId, current: undefined } as unknown as SessionListState
  const subs = new Set<() => void>()
  const actionCalls: { method: string; args: unknown[] }[] = []
  return {
    list: {
      getSnapshot: () => snapshot,
      subscribe: (fn: () => void) => { subs.add(fn); return () => { subs.delete(fn) } },
    },
    notify: () => { for (const fn of [...subs]) fn() },
    listenerCount: () => subs.size,
    actionCalls,
    openSubagent: (address: SubagentAddress) => {
      actionCalls.push({ method: 'openSubagent', args: [address] })
    },
    refreshSubagents: (parentSessionId: SessionId) => {
      actionCalls.push({ method: 'refreshSubagents', args: [parentSessionId] })
      return Promise.resolve()
    },
    setSubagentCatalogOpen: (parentSessionId: SessionId, open: boolean) => {
      actionCalls.push({ method: 'setSubagentCatalogOpen', args: [parentSessionId, open] })
    },
  }
}

async function provideSlotFaces(ctx: Context): Promise<void> {
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: {
      'conversation.session.header.actions': { kind: 'list', scope: 'session' },
      'conversation.composer': { kind: 'chain', scope: 'session' },
    },
  } as never, () => null)
}

/** Boot the plugin over fake slash/sessions faces; returns the captured source and the list face. */
async function fullBench(sessions: SessionSummary[]) {
  const ctx = new Context()
  let captured: InputTriggerSource | undefined
  const face = sessionsWith(sessions)
  ctx.provide('inputTriggers', { registerSource: (src: InputTriggerSource) => { captured = src; return () => {} } })
  ctx.provide('sessions', face)
  ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
  // ui-theme's Appearance row binds a durable scope through these two.
  ctx.provide('remote', { $on: () => () => {} } as never)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  await provideSlotFaces(ctx)
  await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
  await ctx.plugin({ inject: [...inject], apply }).await()
  return { source: captured!, face, ctx }
}

/** Source-only bench for the behavior-contract suites. */
async function bench(sessions: SessionSummary[]): Promise<InputTriggerSource> {
  return (await fullBench(sessions)).source
}

const FAMILY: SessionSummary[] = [
  summary({ id: sid('parent'), displayTitle: 'parent', running: true }),
  summary({ id: sid('c1'), parentId: sid('parent'), displayTitle: 'worker-1', running: true }),
  summary({ id: sid('c2'), parentId: sid('parent'), displayTitle: 'worker-2', running: true }),
  // Filtered out: not running / other parent / label miss.
  summary({ id: sid('c3'), parentId: sid('parent'), displayTitle: 'worker-3', running: false }),
  summary({ id: sid('c4'), parentId: sid('other'), displayTitle: 'worker-4', running: true }),
  summary({ id: sid('c5'), parentId: sid('parent'), displayTitle: 'scout', running: true }),
]

const proj = (id: string): ClientSessionContext => ({ sessionId: sid(id) })

const req = (query: string) =>
  ({ query, position: 'inline' as const, signal: new AbortController().signal })

describe('apply', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['inputTriggers', 'sessions', 'slots', 'locale'])
  })

  it('registers the "@" subagent source; disposal frees the name (HMR safety)', async () => {
    const ctx = new Context()
    await ctx.plugin(InputTriggerService).await()
    ctx.provide('sessions', sessionsWith(FAMILY))
    ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
    // ui-theme's Appearance row binds a durable scope through these two.
    ctx.provide('remote', { $on: () => () => {} } as never)
    ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
    await provideSlotFaces(ctx)
    await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const inputTriggers = ctx.get('inputTriggers') as InputTriggerService
    const rival = {
      trigger: '@' as const,
      name: 'subagent',
      candidates: () => Promise.resolve([]),
      onPick: () => undefined,
    }
    // Live registration holds the (trigger, name) seat…
    expect(() => inputTriggers.registerSource(rival)).toThrow(/already registered/)
    // …and fiber teardown releases it.
    await fiber.dispose()
    expect(() => inputTriggers.registerSource(rival)).not.toThrow()
  })

  it('registers catalog actions and selects read-only subagent composers from session facts', async () => {
    const { ctx, face } = await fullBench(FAMILY)
    const catalogEntry = ctx.slots.entries('conversation.session.header.actions')
      .find(entry => entry.component === SubagentCatalogAction)!
    const actions = (catalogEntry.inject as unknown as (id: SessionId) => SubagentCatalogInjected)(sid('parent'))
    const address: SubagentAddress = {
      parentSessionId: sid('parent'),
      childSessionId: sid('c1'),
      mode: 'continuable',
    }
    actions.openChild(address)
    actions.refresh(sid('parent'))
    actions.setCatalogOpen(sid('parent'), true)
    expect(face.actionCalls).toEqual([
      { method: 'openSubagent', args: [address] },
      { method: 'refreshSubagents', args: [sid('parent')] },
      { method: 'setSubagentCatalogOpen', args: [sid('parent'), true] },
    ])

    const composerEntry = ctx.slots.entries('conversation.composer')
      .find(entry => entry.component === SubagentReadOnlyComposer)!
    const select = composerEntry.select as (owner: ComposerChainProps) => SubagentReadOnlyMatch | null
    const owner = (
      subagent: ConversationSnapshot['subagent'] | undefined,
      running = false,
    ): ComposerChainProps => ({
      interactions: [],
      session: subagent === undefined
        ? undefined
        : ({ subagent, running } as unknown as ConversationSnapshot),
    })
    expect(select(owner(undefined))).toBeNull()
    expect(select(owner(null))).toBeNull()
    expect(select(owner({ address: { ...address, mode: 'one-shot' }, parentAvailable: true })))
      .toEqual({ reason: 'one-shot' })
    // One-shot stays read-only even while running: it has no stop action.
    expect(select(owner({ address: { ...address, mode: 'one-shot' }, parentAvailable: true }, true)))
      .toEqual({ reason: 'one-shot' })
    expect(select(owner({ address, parentAvailable: true }))).toBeNull()
    expect(select(owner({ address, parentAvailable: false })))
      .toEqual({ reason: 'parent-unavailable' })
    // A RUNNING parent-offline continuable yields the default composer, whose
    // disabled input still carries the primary Stop; stopped, it takes back over.
    expect(select(owner({ address, parentAvailable: false }, true))).toBeNull()
  })
})

describe('candidates', () => {
  it('returns running children of the projected session, filtered by label containment', async () => {
    const source = await bench(FAMILY)
    await expect(source.candidates(proj('parent'), req('worker'))).resolves.toEqual([
      { name: 'worker-1' }, { name: 'worker-2' },
    ])
  })

  it('matches every running child on an empty query (containment, not prefix)', async () => {
    const source = await bench(FAMILY)
    await expect(source.candidates(proj('parent'), req(''))).resolves.toEqual([
      { name: 'worker-1' }, { name: 'worker-2' }, { name: 'scout' },
    ])
  })

  it('is candidate-less for a session with no children', async () => {
    const source = await bench(FAMILY)
    await expect(source.candidates(proj('childless'), req(''))).resolves.toEqual([])
  })
})

describe('lexicon', () => {
  it('synchronously serves the projected session\'s full running-children roster', async () => {
    const source = await bench(FAMILY)
    expect(source.lexicon!(proj('parent'))).toEqual(['worker-1', 'worker-2', 'scout'])
    expect(source.lexicon!(proj('childless'))).toEqual([])
  })

  it('subscribeLexicon forwards the session-list change feed and unsubscribes cleanly', async () => {
    const { source, face } = await fullBench(FAMILY)
    let notified = 0
    const off = source.subscribeLexicon!(proj('parent'), () => { notified += 1 })
    expect(face.listenerCount()).toBe(1)
    face.notify()
    expect(notified).toBe(1)
    off()
    expect(face.listenerCount()).toBe(0)
    face.notify()
    expect(notified).toBe(1)
  })
})

describe('pick and codec', () => {
  it('onPick returns the literal @label text with a closing space', async () => {
    const source = await bench(FAMILY)
    const outcome = source.onPick({
      candidate: { name: 'worker-1' },
      session: proj('parent'),
      position: 'inline',
      via: 'menu',
      span: { start: 4, end: 8, draftRev: 3 },
    })
    expect(outcome).toEqual({ text: '@worker-1 ' })
  })

  it('codec projects clipboard `@label` and serializes the same raw label this phase', async () => {
    const source = await bench(FAMILY)
    expect(source.codec!.clipboardText('worker-1')).toBe('@worker-1')
    await expect(source.codec!.serialize('worker-1', new AbortController().signal))
      .resolves.toBe('@worker-1')
  })
})

describe('adjudication', () => {
  it('never participates: no matchSpace/matchEnter hooks on the subagent source', async () => {
    const source = await bench(FAMILY)
    expect('matchSpace' in source && source.matchSpace !== undefined).toBe(false)
    expect('matchEnter' in source && source.matchEnter !== undefined).toBe(false)
  })
})
