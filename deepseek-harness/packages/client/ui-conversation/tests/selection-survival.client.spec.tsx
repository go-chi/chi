// @vitest-environment jsdom
/**
 * Exercises selection persistence through the real SlotRegistry store axis;
 * component stubs cannot prove per-session identity or disposal.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { createChatStore } from '../src/client/stores.ts'

const sid = (s: string): SessionId => s as SessionId

type ChatInstance = ReturnType<ReturnType<typeof createChatStore>['create']>

async function bench() {
  const runtime = await SlotTestRuntime.create()
  const chat = createChatStore()
  // The apply.ts shape: one shared handle across the strict Session header,
  // body, and details registrations; the session-maybe 'conversation' shell
  // carries no store by design. The slots must first exist in the ledger.
  await runtime.root.declare({
    'conversation': { kind: 'single', scope: 'session-maybe' },
    'conversation.session': { kind: 'single', scope: 'session' },
    'conversation.session.header': { kind: 'single', scope: 'session' },
    'details': { kind: 'single', scope: 'session' },
  }, (_p: { renderSlot?: unknown }) => null)
  runtime.slots.register({ name: 'conversation.session', store: chat }, () => null)
  runtime.slots.register({ name: 'conversation.session.header', store: chat }, () => null)
  runtime.slots.register({ name: 'details', store: chat }, () => null)
  runtime.renderRoot() // materializes the host face storeOf resolves through
  return { runtime, chat }
}

/** Resolve the store instance the renderer would hand a slot's component for a session. */
function storeFor(b: Awaited<ReturnType<typeof bench>>, slot: 'conversation.session' | 'details', sessionId: SessionId) {
  return b.runtime.storeOf(slot, sessionId) as ChatInstance
}

beforeEach(() => {
  localStorage.clear()
})

describe('selection survives on the store seat', () => {
  it('one session, two slots: conversation writes, details reads the SAME instance', async () => {
    const b = await bench()

    const conv = storeFor(b, 'conversation.session', sid('s1'))
    const details = storeFor(b, 'details', sid('s1'))
    conv.actions.select({ turnSeq: 3, callId: 'c1' })
    expect(details.store.getSnapshot().selection).toEqual({ turnSeq: 3, callId: 'c1' })
    // Identity, not just value: the shared handle resolves one instance per scope key.
    expect(details).toBe(conv)
    await b.runtime.dispose()
  })

  it('sessions are isolated: s2 selection never bleeds into s1', async () => {
    const b = await bench()

    const one = storeFor(b, 'conversation.session', sid('s1'))
    const two = storeFor(b, 'conversation.session', sid('s2'))
    expect(two).not.toBe(one)
    one.actions.select({ turnSeq: 1, callId: 'a' })
    two.actions.select({ turnSeq: 9, callId: 'z' })
    expect(one.store.getSnapshot().selection).toEqual({ turnSeq: 1, callId: 'a' })
    expect(two.store.getSnapshot().selection).toEqual({ turnSeq: 9, callId: 'z' })
    await b.runtime.dispose()
  })

  it('a list-projection update keeps instance identity and the selection value', async () => {
    const b = await bench()
    const id = sid('s1')

    const store = storeFor(b, 'conversation.session', id)
    store.actions.select({ turnSeq: 3, callId: 'c1' })
    store.actions.setDraft('half-typed')

    // A projection churn elsewhere (list rows re-projected) must not touch
    // store identity: drive the runtime's own list observable.
    await b.runtime.sessions.add({ id, summary: { displayTitle: 'proj-a' } })
    expect(b.runtime.sessions.list.getSnapshot().byId[id]?.displayTitle).toBe('proj-a')

    const after = storeFor(b, 'conversation.session', id)
    expect(after).toBe(store)
    expect(after.store.getSnapshot().selection).toEqual({ turnSeq: 3, callId: 'c1' })
    expect(after.store.getSnapshot().draft).toBe('half-typed')
    await b.runtime.dispose()
  })

  it('session death buries the instance and its persisted draft', async () => {
    const b = await bench()
    await b.runtime.sessions.add({ id: 's1' })

    const doomed = storeFor(b, 'conversation.session', sid('s1'))
    doomed.actions.setDraft('to be buried')
    doomed.actions.select({ turnSeq: 1 })
    expect(localStorage.getItem('dsh.conversation.chat.s1')).not.toBeNull()

    // TestSessions.remove drives the same public slot lifecycle contract the
    // production SessionRuntime calls when the scope dies (pruneStoreScope).
    await b.runtime.sessions.remove('s1')

    // Persisted residue is gone with the session...
    expect(localStorage.getItem('dsh.conversation.chat.s1')).toBeNull()
    // ...and a re-created same-id session starts from a FRESH instance.
    const reborn = storeFor(b, 'conversation.session', sid('s1'))
    expect(reborn).not.toBe(doomed)
    expect(reborn.store.getSnapshot()).toEqual({ selection: null, draft: '', view: null, inspect: null })
    await b.runtime.dispose()
  })
})
