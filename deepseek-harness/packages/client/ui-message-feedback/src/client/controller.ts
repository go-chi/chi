/**
 * Browser-local object layer over one Session's durable message-feedback
 * sidecar. The Host owns per-item compare-and-set: every mutation carries the
 * version this controller last observed, and a `version-conflict` reply carries
 * the authoritative item, so a lost race reconciles from the reply itself
 * instead of refetching the whole Session.
 * @module @deepseek-ai/dsh-client-ui-message-feedback/client/controller
 */

import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { MessageId, SessionId } from '@deepseek-ai/dsh-client-connection/client'
import type {
  MessageFeedbackDeleteResult,
  MessageFeedbackItem,
  MessageFeedbackListResult,
  MessageFeedbackPutResult,
  MessageFeedbackRating,
} from '@deepseek-ai/dsh-message-feedback/types'

/**
 * The three Remote calls this controller needs. The generated face wraps every
 * business result in {@link RemoteResult}: a carrier failure arrives as the
 * `ok: false` branch rather than a rejection, so this controller reads one
 * envelope and never wraps a call to recover a transport error.
 */
export interface MessageFeedbackRemote {
  list: (request: { sessionId: SessionId }) => Promise<RemoteResult<MessageFeedbackListResult>>
  put: (request: {
    sessionId: SessionId
    messageId: MessageId
    rating: MessageFeedbackRating
    note?: string
    ifVersion: MessageFeedbackItem['version'] | null
  }) => Promise<RemoteResult<MessageFeedbackPutResult>>
  delete: (request: {
    sessionId: SessionId
    messageId: MessageId
    ifVersion: MessageFeedbackItem['version']
  }) => Promise<RemoteResult<MessageFeedbackDeleteResult>>
}

/** Load state of the one list read that seeds every per-message control. */
export type MessageFeedbackStatus = 'cold' | 'loading' | 'ready' | 'error'

/** Immutable view published to every per-message control in one Session. */
export interface MessageFeedbackView {
  status: MessageFeedbackStatus
  /** Current item per message, keyed by the addressed message id. */
  items: ReadonlyMap<MessageId, MessageFeedbackItem>
  /** Reason the last load failed, cleared by the next successful load. */
  error: string | null
}

/** Settled action shape rendered by the message-level controls. */
export type MessageFeedbackActionResult =
  | { ok: true }
  | { ok: false; error: { code: string; message: string } }

// `Object.freeze` does not protect a Map: `set`/`delete` write internal slots,
// not properties. Immutability here is by discipline instead — the view type is
// ReadonlyMap and every publish hands over a freshly built Map that this class
// keeps no mutable reference to.
const EMPTY_ITEMS: ReadonlyMap<MessageId, MessageFeedbackItem> = new Map()

const INITIAL_VIEW: MessageFeedbackView = Object.freeze({
  status: 'cold',
  items: EMPTY_ITEMS,
  error: null,
})

const OK: MessageFeedbackActionResult = Object.freeze({ ok: true })

const DISPOSED: MessageFeedbackActionResult = Object.freeze({
  ok: false,
  error: Object.freeze({ code: 'disposed', message: 'feedback controller is disposed' }),
})

/** Human-readable text for one business failure code. */
function describe(code: string): string {
  switch (code) {
    case 'session-not-found': return 'this session is no longer persisted'
    case 'target-not-found': return 'this message is not a persisted assistant message'
    case 'version-conflict': return 'feedback changed elsewhere'
    case 'note-blank': return 'a note must contain a non-whitespace character'
    case 'note-too-large': return 'the note is too long'
    default: return code
  }
}

/** Build the rejected branch for one business failure code. */
function fail(code: string): MessageFeedbackActionResult {
  return { ok: false, error: { code, message: describe(code) } }
}

/** Carrier failure rendered with the Host-supplied code and message. */
function carrierFailure(error: { code: string; message: string }): MessageFeedbackActionResult {
  return { ok: false, error: { code: error.code, message: error.message } }
}

/**
 * Per-session feedback object layer. One instance backs every per-message
 * control in that Session, so a single list read seeds them all.
 */
export class MessageFeedbackController implements HostObservable<MessageFeedbackView> {
  private view = INITIAL_VIEW
  private readonly listeners = new Set<() => void>()
  private loadPromise: Promise<MessageFeedbackActionResult> | null = null
  private operationTail: Promise<void> = Promise.resolve()
  private disposed = false

  /**
   * @param remote - the messageFeedback Remote namespace.
   * @param sessionId - Session owning every addressed assistant message.
   */
  constructor(
    private readonly remote: MessageFeedbackRemote,
    private readonly sessionId: SessionId,
  ) {}

  /** Return the cached immutable view. */
  getSnapshot = (): MessageFeedbackView => this.view

  /** Subscribe to view replacement. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Load once; a failed load stays retryable.
   * @returns the settled load result, shared by concurrent callers.
   */
  ensure(): Promise<MessageFeedbackActionResult> {
    if (this.view.status === 'ready') return Promise.resolve(OK)
    return this.refresh()
  }

  /**
   * Re-read the authoritative list, collapsing concurrent callers onto one
   * in-flight read.
   *
   * This is the unserialized read used to seed a cold controller, where no
   * mutation can be in flight yet. A reconnect must use {@link resync} instead:
   * an unserialized list response can otherwise arrive after a newer mutation's
   * reply and overwrite the version that mutation just committed.
   * @returns the settled reload result.
   */
  refresh(): Promise<MessageFeedbackActionResult> {
    if (this.loadPromise !== null) return this.loadPromise
    this.publish({ status: 'loading', items: this.view.items, error: null })
    const pending = this.load()
    this.loadPromise = pending
    return pending.finally(() => { this.loadPromise = null })
  }

  /**
   * Re-read the list behind this Session's queued mutations, so a reconnect
   * cannot resurrect a version an in-flight mutation already replaced.
   * @returns the settled reload result.
   */
  resync(): Promise<MessageFeedbackActionResult> {
    // seed: false — this operation *is* the read, so pre-seeding would either
    // short-circuit it (status already ready) or run it twice.
    return this.mutate(() => this.refresh(), { seed: false })
  }

  /**
   * Create or replace feedback for one message, comparing against the version
   * this controller last observed.
   *
   * The note is resolved here rather than by the caller: `mutate` awaits the
   * one list read first, so this body always sees the committed item, while a
   * control that rendered before that read completed would still be holding
   * `undefined`. Omitting `note` therefore keeps whatever is stored; only
   * {@link clearNote} removes one.
   * @param messageId - target assistant message.
   * @param rating - desired judgment.
   * @param note - replacement explanation; omitted keeps the stored note.
   * @returns the settled mutation result.
   */
  rate(
    messageId: MessageId,
    rating: MessageFeedbackRating,
    note?: string,
  ): Promise<MessageFeedbackActionResult> {
    return this.mutate(async () => {
      const observed = this.view.items.get(messageId)
      return await this.putCommitted(messageId, rating, note ?? observed?.note, observed)
    })
  }

  /**
   * Replace one message's rating with the opposite judgment, or retract it when
   * the committed rating already matches. The decision reads the committed item
   * inside the serialized mutation, so a click that lands before the first list
   * read still toggles against the stored value rather than the empty view a
   * cold control rendered.
   * @param messageId - target assistant message.
   * @param rating - the judgment the human asked for.
   * @returns the settled mutation result.
   */
  toggle(messageId: MessageId, rating: MessageFeedbackRating): Promise<MessageFeedbackActionResult> {
    return this.mutate(async () => {
      const observed = this.view.items.get(messageId)
      if (observed?.rating === rating) return await this.deleteCommitted(messageId, observed)
      return await this.putCommitted(messageId, rating, observed?.note, observed)
    })
  }

  /**
   * Drop the note while keeping the rating. Absent feedback needs no call.
   * @param messageId - target assistant message.
   * @returns the settled mutation result.
   */
  clearNote(messageId: MessageId): Promise<MessageFeedbackActionResult> {
    return this.mutate(async () => {
      const observed = this.view.items.get(messageId)
      if (observed === undefined || observed.note === undefined) return OK
      return await this.putCommitted(messageId, observed.rating, undefined, observed)
    })
  }

  /**
   * Remove feedback for one message. A message with no known item is already
   * in the requested state, so no call is made.
   * @param messageId - target assistant message.
   * @returns the settled mutation result.
   */
  clear(messageId: MessageId): Promise<MessageFeedbackActionResult> {
    return this.mutate(async () => {
      const observed = this.view.items.get(messageId)
      if (observed === undefined) return OK
      return await this.deleteCommitted(messageId, observed)
    })
  }

  /** Commit one put against the observed version and reconcile a conflict. */
  private async putCommitted(
    messageId: MessageId,
    rating: MessageFeedbackRating,
    note: string | undefined,
    observed: MessageFeedbackItem | undefined,
  ): Promise<MessageFeedbackActionResult> {
    const carried = await this.remote.put({
      sessionId: this.sessionId,
      messageId,
      rating,
      ...(note === undefined ? {} : { note }),
      ifVersion: observed?.version ?? null,
    })
    if (!carried.ok) return carrierFailure(carried.error)
    const result = carried.value
    if (result.ok) {
      this.commit(messageId, result.value)
      return OK
    }
    if (result.error.code === 'version-conflict') this.commit(messageId, result.error.current)
    return fail(result.error.code)
  }

  /** Commit one delete against the observed version and reconcile a conflict. */
  private async deleteCommitted(
    messageId: MessageId,
    observed: MessageFeedbackItem,
  ): Promise<MessageFeedbackActionResult> {
    const carried = await this.remote.delete({
      sessionId: this.sessionId,
      messageId,
      ifVersion: observed.version,
    })
    if (!carried.ok) return carrierFailure(carried.error)
    const result = carried.value
    if (result.ok) {
      this.commit(messageId, null)
      return OK
    }
    if (result.error.code === 'version-conflict') this.commit(messageId, result.error.current)
    return fail(result.error.code)
  }

  /** Drop subscribers and refuse further work when the owning fiber unloads. */
  dispose(): void {
    this.disposed = true
    this.listeners.clear()
  }

  /** Fetch the whole sidecar and publish it as the seeded view. */
  private async load(): Promise<MessageFeedbackActionResult> {
    try {
      const carried = await this.remote.list({ sessionId: this.sessionId })
      if (this.disposed) return OK
      if (!carried.ok) {
        this.publish({ status: 'error', items: this.view.items, error: carried.error.message })
        return carrierFailure(carried.error)
      }
      const result = carried.value
      if (!result.ok) {
        this.publish({ status: 'error', items: this.view.items, error: describe(result.error.code) })
        return fail(result.error.code)
      }
      const items = new Map<MessageId, MessageFeedbackItem>()
      for (const item of result.value.items) items.set(item.messageId, item)
      this.publish({ status: 'ready', items, error: null })
      return OK
    } catch (error) {
      if (this.disposed) return OK
      const message = error instanceof Error ? error.message : 'message feedback list failed'
      this.publish({ status: 'error', items: this.view.items, error: message })
      return { ok: false, error: { code: 'transport', message } }
    }
  }

  /**
   * Serialize one mutation behind this Session's prior mutation so queued
   * operations always compare against the committed version, and translate a
   * transport throw into the same settled shape the controls already render.
   */
  private mutate(
    operation: () => Promise<MessageFeedbackActionResult>,
    options: { readonly seed?: boolean } = {},
  ): Promise<MessageFeedbackActionResult> {
    const guarded = async (): Promise<MessageFeedbackActionResult> => {
      if (this.disposed) return DISPOSED
      if (options.seed !== false) {
        const loaded = await this.ensure()
        if (!loaded.ok) return loaded
        // Disposal can land while the seeding read is in flight; without this
        // second check the fiber would still reach the wire after unloading.
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- dispose() can run during the await.
        if (this.disposed) return DISPOSED
      }
      try {
        return await operation()
      } catch (error) {
        return {
          ok: false,
          error: {
            code: 'transport',
            message: error instanceof Error ? error.message : 'message feedback mutation failed',
          },
        }
      }
    }
    const result = this.operationTail.then(guarded, guarded)
    // `guarded` settles every carrier and business failure as a
    // MessageFeedbackActionResult and never rethrows, so this tail cannot reject and
    // needs no rejection handler.
    this.operationTail = result.then(() => undefined)
    return result
  }

  /**
   * Replace one message's entry, keeping every other entry's identity. Only a
   * `mutate` operation reaches this, and `mutate` refuses admission once the
   * controller is disposed, so no disposal guard belongs here; `publish` is
   * the single place that stops notifying after listeners are dropped.
   */
  private commit(messageId: MessageId, item: MessageFeedbackItem | null): void {
    const items = new Map(this.view.items)
    if (item === null) items.delete(messageId)
    else items.set(messageId, item)
    this.publish({ status: 'ready', items, error: null })
  }

  /** Replace the view and contain subscriber failures at the observable boundary. */
  private publish(view: MessageFeedbackView): void {
    this.view = Object.freeze(view)
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (error) {
        console.error('[ui-message-feedback] subscriber threw:', error)
      }
    }
  }
}
