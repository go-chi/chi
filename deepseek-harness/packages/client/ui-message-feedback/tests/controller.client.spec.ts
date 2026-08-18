/**
 * MessageFeedbackController: the browser-local object layer over one Session's
 * message-feedback sidecar. These specs pin the per-item compare-and-set
 * contract — every mutation sends the version last observed, a conflict
 * reconciles from the authoritative item carried by the reply, mutations
 * serialize per Session, and a disposed controller stops publishing.
 */
import { describe, expect, it, vi } from 'vitest'
import type { MessageId, SessionId } from '@deepseek-ai/dsh-client-connection/client'
import type {
  MessageFeedbackItem, MessageFeedbackVersion,
} from '@deepseek-ai/dsh-message-feedback/types'
import { MessageFeedbackController, type MessageFeedbackRemote } from '../src/client/controller.ts'

const SESSION = 's-1' as SessionId
const MSG = 'm-1' as MessageId
const OTHER = 'm-2' as MessageId

const version = (v: string): MessageFeedbackVersion => v as MessageFeedbackVersion

function item(overrides: Partial<MessageFeedbackItem> = {}): MessageFeedbackItem {
  return {
    messageId: MSG,
    rating: 'positive',
    version: version('v1'),
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

/** A recording fake Remote whose per-method answers are scripted per call. */
type Script = {
  list?: (request: unknown) => Promise<unknown>
  put?: (request: unknown) => Promise<unknown>
  delete?: (request: unknown) => Promise<unknown>
}

/**
 * A recording fake Remote. Scripts return the *business* result; this wraps it
 * in the carrier envelope the generated face uses, so specs stay readable. A
 * script may also return an already-enveloped `{ok:false,error:{code,message,
 * details}}` to exercise a carrier failure.
 */
function fakeRemote(script: Script = {}) {
  const calls: { method: string; request: unknown }[] = []
  const isCarrier = (v: unknown): boolean =>
    typeof v === 'object' && v !== null && 'ok' in v && v.ok === false
      && 'error' in v && 'details' in ((v as { error: object }).error ?? {})
  const record = (method: 'list' | 'put' | 'delete', real: Script[keyof Script], fallback: unknown) =>
    (request: never): Promise<never> => {
      calls.push({ method, request })
      const business = real === undefined ? Promise.resolve(fallback) : real(request)
      return business.then(v => (isCarrier(v) ? v : { ok: true, value: v })) as Promise<never>
    }
  const remote = {
    list: record('list', script.list, { ok: true, value: { items: [] } }),
    put: record('put', script.put, { ok: true, value: item() }),
    delete: record('delete', script.delete, { ok: true, value: { absent: true } }),
  } as unknown as MessageFeedbackRemote
  return { remote, calls }
}

describe('MessageFeedbackController', () => {
  it('seeds the view from one list read and keys items by message id', async () => {
    const seeded = item({ note: 'good' })
    const { remote, calls } = fakeRemote({
      list: () => Promise.resolve({ ok: true, value: { items: [seeded] } }),
    })
    const controller = new MessageFeedbackController(remote, SESSION)

    expect(controller.getSnapshot().status).toBe('cold')
    expect(await controller.ensure()).toEqual({ ok: true })

    const view = controller.getSnapshot()
    expect(view.status).toBe('ready')
    expect(view.items.get(MSG)).toEqual(seeded)
    expect(calls).toEqual([{ method: 'list', request: { sessionId: SESSION } }])
  })

  it('collapses concurrent loads onto one in-flight read', async () => {
    const { remote, calls } = fakeRemote()
    const controller = new MessageFeedbackController(remote, SESSION)

    await Promise.all([controller.ensure(), controller.ensure(), controller.refresh()])

    expect(calls.filter(call => call.method === 'list')).toHaveLength(1)
  })

  it('sends ifVersion null for a first rating and the observed version afterwards', async () => {
    const first = item({ version: version('v1') })
    const second = item({ version: version('v2'), rating: 'negative' })
    const { remote, calls } = fakeRemote({
      put: request => Promise.resolve({
        ok: true,
        value: (request as { rating: string }).rating === 'positive' ? first : second,
      }),
    })
    const controller = new MessageFeedbackController(remote, SESSION)

    expect(await controller.rate(MSG, 'positive')).toEqual({ ok: true })
    expect(await controller.rate(MSG, 'negative')).toEqual({ ok: true })

    const puts = calls.filter(call => call.method === 'put').map(call => call.request)
    expect(puts[0]).toMatchObject({ messageId: MSG, rating: 'positive', ifVersion: null })
    expect(puts[1]).toMatchObject({ messageId: MSG, rating: 'negative', ifVersion: version('v1') })
    expect(controller.getSnapshot().items.get(MSG)).toEqual(second)
  })

  it('forwards an optional note and omits the field when absent', async () => {
    const { remote, calls } = fakeRemote()
    const controller = new MessageFeedbackController(remote, SESSION)

    await controller.rate(MSG, 'positive', 'helpful')
    await controller.rate(OTHER, 'negative')

    const puts = calls.filter(call => call.method === 'put').map(call => call.request as Record<string, unknown>)
    expect(puts[0]?.note).toBe('helpful')
    expect(puts[1]).not.toHaveProperty('note')
  })

  it('reconciles a version conflict from the authoritative item without refetching', async () => {
    const authoritative = item({ version: version('v9'), rating: 'negative', note: 'changed elsewhere' })
    const { remote, calls } = fakeRemote({
      put: () => Promise.resolve({
        ok: false,
        error: { code: 'version-conflict', current: authoritative },
      }),
    })
    const controller = new MessageFeedbackController(remote, SESSION)

    expect(await controller.rate(MSG, 'positive')).toEqual({
      ok: false,
      error: { code: 'version-conflict', message: 'feedback changed elsewhere' },
    })

    expect(controller.getSnapshot().items.get(MSG)).toEqual(authoritative)
    expect(calls.filter(call => call.method === 'list')).toHaveLength(1)
  })

  it('drops the local item when a conflict reports the feedback is gone', async () => {
    const { remote } = fakeRemote({
      list: () => Promise.resolve({ ok: true, value: { items: [item()] } }),
      delete: () => Promise.resolve({
        ok: false,
        error: { code: 'version-conflict', current: null },
      }),
    })
    const controller = new MessageFeedbackController(remote, SESSION)
    await controller.ensure()

    expect(await controller.clear(MSG)).toMatchObject({ ok: false, error: { code: 'version-conflict' } })
    expect(controller.getSnapshot().items.has(MSG)).toBe(false)
  })

  it('deletes with the observed version and removes the item on success', async () => {
    const { remote, calls } = fakeRemote({
      list: () => Promise.resolve({ ok: true, value: { items: [item({ version: version('v7') })] } }),
    })
    const controller = new MessageFeedbackController(remote, SESSION)
    await controller.ensure()

    expect(await controller.clear(MSG)).toEqual({ ok: true })

    expect(calls.filter(call => call.method === 'delete')[0]?.request)
      .toEqual({ sessionId: SESSION, messageId: MSG, ifVersion: version('v7') })
    expect(controller.getSnapshot().items.has(MSG)).toBe(false)
  })

  it('treats clearing an unrated message as already satisfied without a call', async () => {
    const { remote, calls } = fakeRemote()
    const controller = new MessageFeedbackController(remote, SESSION)

    expect(await controller.clear(MSG)).toEqual({ ok: true })
    expect(calls.filter(call => call.method === 'delete')).toHaveLength(0)
  })

  it('serializes mutations so each one compares against the committed version', async () => {
    let inFlight = 0
    let overlapped = false
    const versions = [version('v1'), version('v2')]
    let index = 0
    const { remote, calls } = fakeRemote({
      put: async () => {
        inFlight += 1
        if (inFlight > 1) overlapped = true
        await Promise.resolve()
        inFlight -= 1
        const next = versions[index] ?? version('vN')
        index += 1
        return { ok: true, value: item({ version: next }) }
      },
    })
    const controller = new MessageFeedbackController(remote, SESSION)

    await Promise.all([controller.rate(MSG, 'positive'), controller.rate(MSG, 'negative')])

    expect(overlapped).toBe(false)
    const puts = calls.filter(call => call.method === 'put').map(call => call.request as Record<string, unknown>)
    expect(puts[0]?.ifVersion).toBeNull()
    expect(puts[1]?.ifVersion).toBe(version('v1'))
  })

  it('publishes an error status when the list read is rejected by the Host', async () => {
    const { remote } = fakeRemote({
      list: () => Promise.resolve({ ok: false, error: { code: 'session-not-found', sessionId: SESSION } }),
    })
    const controller = new MessageFeedbackController(remote, SESSION)

    expect(await controller.ensure()).toMatchObject({ ok: false, error: { code: 'session-not-found' } })
    expect(controller.getSnapshot()).toMatchObject({
      status: 'error',
      error: 'this session is no longer persisted',
    })
  })

  it('settles a transport throw as a result instead of rejecting', async () => {
    const { remote } = fakeRemote({ list: () => Promise.reject(new Error('socket closed')) })
    const controller = new MessageFeedbackController(remote, SESSION)

    expect(await controller.ensure()).toEqual({
      ok: false,
      error: { code: 'transport', message: 'socket closed' },
    })
    expect(controller.getSnapshot().status).toBe('error')
  })

  it('settles a mutation transport throw without corrupting the view', async () => {
    const { remote } = fakeRemote({ put: () => Promise.reject(new Error('socket closed')) })
    const controller = new MessageFeedbackController(remote, SESSION)

    expect(await controller.rate(MSG, 'positive')).toEqual({
      ok: false,
      error: { code: 'transport', message: 'socket closed' },
    })
    expect(controller.getSnapshot().items.has(MSG)).toBe(false)
  })

  it('notifies subscribers on publication and stops after unsubscribe', async () => {
    const { remote } = fakeRemote()
    const controller = new MessageFeedbackController(remote, SESSION)
    const listener = vi.fn()
    const unsubscribe = controller.subscribe(listener)

    await controller.ensure()
    const seen = listener.mock.calls.length
    expect(seen).toBeGreaterThan(0)

    unsubscribe()
    await controller.rate(MSG, 'positive')
    expect(listener).toHaveBeenCalledTimes(seen)
  })

  it('contains a throwing subscriber at the observable boundary', async () => {
    const { remote } = fakeRemote()
    const controller = new MessageFeedbackController(remote, SESSION)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    controller.subscribe(() => { throw new Error('subscriber exploded') })
    const healthy = vi.fn()
    controller.subscribe(healthy)

    await controller.ensure()

    expect(healthy).toHaveBeenCalled()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('refuses mutations and stops publishing once disposed', async () => {
    const { remote, calls } = fakeRemote()
    const controller = new MessageFeedbackController(remote, SESSION)
    await controller.ensure()
    const listener = vi.fn()
    controller.subscribe(listener)

    controller.dispose()
    const before = calls.length

    expect(await controller.rate(MSG, 'positive')).toMatchObject({ ok: false, error: { code: 'disposed' } })
    expect(calls).toHaveLength(before)
    expect(listener).not.toHaveBeenCalled()
  })

  it('renders a human explanation for every business failure code', async () => {
    const codes = [
      ['session-not-found', 'this session is no longer persisted'],
      ['target-not-found', 'this message is not a persisted assistant message'],
      ['note-blank', 'a note must contain a non-whitespace character'],
      ['note-too-large', 'the note is too long'],
    ] as const
    for (const [code, message] of codes) {
      const { remote } = fakeRemote({
        list: () => Promise.resolve({ ok: false, error: { code, sessionId: SESSION } } as never),
      })
      const controller = new MessageFeedbackController(remote, SESSION)
      expect(await controller.ensure()).toMatchObject({ ok: false, error: { code } })
      expect(controller.getSnapshot().error).toBe(message)
    }
  })

  it('falls back to the raw code for an unrecognized failure', async () => {
    const { remote } = fakeRemote({
      list: () => Promise.resolve({ ok: false, error: { code: 'brand-new-code' } } as never),
    })
    const controller = new MessageFeedbackController(remote, SESSION)

    expect(await controller.ensure()).toMatchObject({ ok: false, error: { code: 'brand-new-code' } })
    expect(controller.getSnapshot().error).toBe('brand-new-code')
  })

  it('publishes nothing when the list settles after disposal', async () => {
    let release = (): void => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    const { remote } = fakeRemote({
      list: async () => {
        await gate
        return { ok: true, value: { items: [item()] } }
      },
    })
    const controller = new MessageFeedbackController(remote, SESSION)
    const pending = controller.ensure()
    const listener = vi.fn()
    controller.subscribe(listener)

    controller.dispose()
    release()

    expect(await pending).toEqual({ ok: true })
    expect(controller.getSnapshot().items.has(MSG)).toBe(false)
    expect(listener).not.toHaveBeenCalled()
  })

  it('swallows a rejected list that settles after disposal', async () => {
    let reject = (): void => {}
    const gate = new Promise<void>((_resolve, rejectFn) => { reject = () => { rejectFn(new Error('late')) } })
    const { remote } = fakeRemote({ list: () => gate })
    const controller = new MessageFeedbackController(remote, SESSION)
    const pending = controller.ensure()

    controller.dispose()
    reject()

    expect(await pending).toEqual({ ok: true })
    expect(controller.getSnapshot().status).not.toBe('error')
  })

  it('describes a non-Error list rejection with a stable message', async () => {
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- the non-Error rejection is the scenario under test.
    const { remote } = fakeRemote({ list: () => Promise.reject('socket string') })
    const controller = new MessageFeedbackController(remote, SESSION)

    expect(await controller.ensure()).toEqual({
      ok: false,
      error: { code: 'transport', message: 'message feedback list failed' },
    })
  })

  it('describes a non-Error mutation rejection with a stable message', async () => {
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- the non-Error rejection is the scenario under test.
    const { remote } = fakeRemote({ put: () => Promise.reject('nope') })
    const controller = new MessageFeedbackController(remote, SESSION)

    expect(await controller.rate(MSG, 'positive')).toEqual({
      ok: false,
      error: { code: 'transport', message: 'message feedback mutation failed' },
    })
  })

  it('propagates a failed load to a queued mutation without calling the wire', async () => {
    const { remote, calls } = fakeRemote({
      list: () => Promise.resolve({ ok: false, error: { code: 'session-not-found', sessionId: SESSION } }),
    })
    const controller = new MessageFeedbackController(remote, SESSION)

    expect(await controller.rate(MSG, 'positive')).toMatchObject({
      ok: false,
      error: { code: 'session-not-found' },
    })
    expect(calls.filter(call => call.method === 'put')).toHaveLength(0)
  })

  it('keeps a later mutation running after an earlier one settles as a failure', async () => {
    let first = true
    const { remote } = fakeRemote({
      put: () => {
        if (first) {
          first = false
          return Promise.reject(new Error('first blew up'))
        }
        return Promise.resolve({ ok: true, value: item({ rating: 'negative' }) })
      },
    })
    const controller = new MessageFeedbackController(remote, SESSION)

    const [a, b] = await Promise.all([
      controller.rate(MSG, 'positive'),
      controller.rate(MSG, 'negative'),
    ])

    expect(a).toMatchObject({ ok: false, error: { code: 'transport' } })
    expect(b).toEqual({ ok: true })
    expect(controller.getSnapshot().items.get(MSG)?.rating).toBe('negative')
  })

  it('ignores a conflict reconciliation that lands after disposal', async () => {
    // The mutate() guard only refuses work admitted after disposal, so this
    // exercises commit()'s own guard: the call is already in flight when the
    // fiber unloads, and its authoritative item must not be published.
    let release = (): void => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    const { remote } = fakeRemote({
      list: () => Promise.resolve({ ok: true, value: { items: [item({ version: version('v1') })] } }),
      put: async () => {
        await gate
        return { ok: false, error: { code: 'version-conflict', current: item({ version: version('v2'), rating: 'negative' }) } }
      },
    })
    const controller = new MessageFeedbackController(remote, SESSION)
    await controller.ensure()
    const listener = vi.fn()
    controller.subscribe(listener)
    const pending = controller.rate(MSG, 'negative')

    controller.dispose()
    release()
    await pending

    // publish() drops its listener set on dispose, so no subscriber is told.
    expect(listener).not.toHaveBeenCalled()
  })

  it('drops a delete conflict reconciliation once disposed mid-flight', async () => {
    let release = (): void => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    const { remote } = fakeRemote({
      list: () => Promise.resolve({ ok: true, value: { items: [item()] } }),
      delete: async () => {
        await gate
        return { ok: false, error: { code: 'version-conflict', current: null } }
      },
    })
    const controller = new MessageFeedbackController(remote, SESSION)
    await controller.ensure()
    const pending = controller.clear(MSG)

    const listener = vi.fn()
    controller.subscribe(listener)
    controller.dispose()
    release()
    await pending

    // The reconciliation still computes, but no subscriber is notified.
    expect(listener).not.toHaveBeenCalled()
  })

  it('leaves the local item untouched when a rating fails for a non-conflict reason', async () => {
    const existing = item({ version: version('v3'), rating: 'positive' })
    const { remote } = fakeRemote({
      list: () => Promise.resolve({ ok: true, value: { items: [existing] } }),
      put: () => Promise.resolve({ ok: false, error: { code: 'note-too-large', maxBytes: 8, actualBytes: 9 } }),
    })
    const controller = new MessageFeedbackController(remote, SESSION)
    await controller.ensure()

    expect(await controller.rate(MSG, 'negative', 'far too long')).toMatchObject({
      ok: false,
      error: { code: 'note-too-large' },
    })
    expect(controller.getSnapshot().items.get(MSG)).toEqual(existing)
  })

  it('leaves the local item untouched when a delete fails for a non-conflict reason', async () => {
    const existing = item({ version: version('v4') })
    const { remote } = fakeRemote({
      list: () => Promise.resolve({ ok: true, value: { items: [existing] } }),
      delete: () => Promise.resolve({ ok: false, error: { code: 'session-not-found', sessionId: SESSION } }),
    })
    const controller = new MessageFeedbackController(remote, SESSION)
    await controller.ensure()

    expect(await controller.clear(MSG)).toMatchObject({
      ok: false,
      error: { code: 'session-not-found' },
    })
    expect(controller.getSnapshot().items.get(MSG)).toEqual(existing)
  })

  it('preserves a stored note when a rating switch omits one', async () => {
    // Regression: a control that rendered before the first list read holds no
    // item, so it passes note=undefined; that must not erase the stored note.
    const stored = item({ version: version('v1'), rating: 'positive', note: 'keep me' })
    const { remote, calls } = fakeRemote({
      list: () => Promise.resolve({ ok: true, value: { items: [stored] } }),
    })
    const controller = new MessageFeedbackController(remote, SESSION)

    expect(await controller.rate(MSG, 'negative')).toEqual({ ok: true })

    const put = calls.filter(c => c.method === 'put')[0]?.request as Record<string, unknown>
    expect(put.note).toBe('keep me')
    expect(put.rating).toBe('negative')
  })

  it('toggle retracts when the committed rating already matches', async () => {
    const stored = item({ version: version('v1'), rating: 'positive' })
    const { remote, calls } = fakeRemote({
      list: () => Promise.resolve({ ok: true, value: { items: [stored] } }),
    })
    const controller = new MessageFeedbackController(remote, SESSION)

    expect(await controller.toggle(MSG, 'positive')).toEqual({ ok: true })

    expect(calls.filter(c => c.method === 'delete')).toHaveLength(1)
    expect(calls.filter(c => c.method === 'put')).toHaveLength(0)
    expect(controller.getSnapshot().items.has(MSG)).toBe(false)
  })

  it('toggle decides from the committed item, not a cold view', async () => {
    // The click lands before any list read: the cold view knows no item, yet the
    // stored rating matches, so the toggle must retract rather than re-put.
    const stored = item({ version: version('v1'), rating: 'positive', note: 'kept' })
    const { remote, calls } = fakeRemote({
      list: () => Promise.resolve({ ok: true, value: { items: [stored] } }),
    })
    const controller = new MessageFeedbackController(remote, SESSION)
    expect(controller.getSnapshot().status).toBe('cold')

    expect(await controller.toggle(MSG, 'positive')).toEqual({ ok: true })

    expect(calls.filter(c => c.method === 'delete')).toHaveLength(1)
  })

  it('toggle replaces the opposite rating and carries the note forward', async () => {
    const stored = item({ version: version('v1'), rating: 'positive', note: 'kept' })
    const { remote, calls } = fakeRemote({
      list: () => Promise.resolve({ ok: true, value: { items: [stored] } }),
    })
    const controller = new MessageFeedbackController(remote, SESSION)

    expect(await controller.toggle(MSG, 'negative')).toEqual({ ok: true })

    const put = calls.filter(c => c.method === 'put')[0]?.request as Record<string, unknown>
    expect(put).toMatchObject({ rating: 'negative', note: 'kept', ifVersion: version('v1') })
  })

  it('clearNote drops the note and keeps the rating', async () => {
    const stored = item({ version: version('v1'), rating: 'negative', note: 'remove me' })
    const { remote, calls } = fakeRemote({
      list: () => Promise.resolve({ ok: true, value: { items: [stored] } }),
    })
    const controller = new MessageFeedbackController(remote, SESSION)

    expect(await controller.clearNote(MSG)).toEqual({ ok: true })

    const put = calls.filter(c => c.method === 'put')[0]?.request as Record<string, unknown>
    expect(put.rating).toBe('negative')
    expect(put).not.toHaveProperty('note')
  })

  it('clearNote is a no-op when there is no note to drop', async () => {
    const { remote, calls } = fakeRemote({
      list: () => Promise.resolve({ ok: true, value: { items: [item()] } }),
    })
    const controller = new MessageFeedbackController(remote, SESSION)

    expect(await controller.clearNote(MSG)).toEqual({ ok: true })
    expect(calls.filter(c => c.method === 'put')).toHaveLength(0)
  })

  it('resync serializes behind an in-flight mutation', async () => {
    // Regression: an unserialized reconnect read could land after a newer put
    // and resurrect the version that put had already replaced.
    const order: string[] = []
    let releasePut = (): void => {}
    const putGate = new Promise<void>((r) => { releasePut = r })
    const { remote } = fakeRemote({
      list: () => {
        order.push('list')
        return Promise.resolve({ ok: true, value: { items: [item({ version: version('v1') })] } })
      },
      put: async () => {
        order.push('put:start')
        await putGate
        order.push('put:end')
        return { ok: true, value: item({ version: version('v9'), rating: 'negative' }) }
      },
    })
    const controller = new MessageFeedbackController(remote, SESSION)
    await controller.ensure()

    const rating = controller.rate(MSG, 'negative')
    const resync = controller.resync()
    releasePut()
    await Promise.all([rating, resync])

    // The reconnect read runs only after the mutation settled.
    expect(order.indexOf('list', 1)).toBeGreaterThan(order.indexOf('put:end'))
  })

  it('refuses a mutation disposed while its seeding read is in flight', async () => {
    // Dispose only once the seeding list call has actually started, so the
    // mutation is already past the admission check and must be stopped by the
    // second guard that runs after ensure() resolves.
    let release = (): void => {}
    const gate = new Promise<void>((r) => { release = r })
    let started = (): void => {}
    const listStarted = new Promise<void>((r) => { started = r })
    const { remote, calls } = fakeRemote({
      list: async () => {
        started()
        await gate
        return { ok: true, value: { items: [] } }
      },
    })
    const controller = new MessageFeedbackController(remote, SESSION)
    const pending = controller.rate(MSG, 'positive')

    await listStarted
    controller.dispose()
    release()

    expect(await pending).toMatchObject({ ok: false, error: { code: 'disposed' } })
    expect(calls.filter(c => c.method === 'put')).toHaveLength(0)
  })

  it('renders a carrier failure from the Remote envelope', async () => {
    // The generated face folds transport faults into ok:false with a
    // RemoteFailure, so the controller reads them as values, not rejections.
    const { remote } = fakeRemote({
      list: () => Promise.resolve({
        ok: false,
        error: { code: 'carrier-closed', message: 'socket closed', details: {} },
      }),
    })
    const controller = new MessageFeedbackController(remote, SESSION)

    expect(await controller.ensure()).toEqual({
      ok: false,
      error: { code: 'carrier-closed', message: 'socket closed' },
    })
    expect(controller.getSnapshot()).toMatchObject({ status: 'error', error: 'socket closed' })
  })

  it('renders a carrier failure on a mutation without touching the view', async () => {
    const { remote } = fakeRemote({
      put: () => Promise.resolve({
        ok: false,
        error: { code: 'carrier-closed', message: 'socket closed', details: {} },
      }),
    })
    const controller = new MessageFeedbackController(remote, SESSION)

    expect(await controller.rate(MSG, 'positive')).toEqual({
      ok: false,
      error: { code: 'carrier-closed', message: 'socket closed' },
    })
    expect(controller.getSnapshot().items.has(MSG)).toBe(false)
  })

  it('renders a carrier failure on a delete', async () => {
    const { remote } = fakeRemote({
      list: () => Promise.resolve({ ok: true, value: { items: [item()] } }),
      delete: () => Promise.resolve({
        ok: false,
        error: { code: 'carrier-closed', message: 'socket closed', details: {} },
      }),
    })
    const controller = new MessageFeedbackController(remote, SESSION)
    await controller.ensure()

    expect(await controller.clear(MSG)).toMatchObject({ ok: false, error: { code: 'carrier-closed' } })
    expect(controller.getSnapshot().items.has(MSG)).toBe(true)
  })
})
