// PendingWait: the carrier-protocol half of a pending host interaction. The runtime owns only
// envelope knowledge (rpcId backfill into a client-response); domain result encoding belongs to
// the interaction's consumer package.

import type {
  ClientResponse, MuxFrame, RpcId, RpcReceipt, SessionId,
} from '@deepseek-ai/dsh-api-remotes/client'

/** Kind-keyed payload map: the requested frame's domain fields (envelope fields stripped). */
export interface PendingPayloads {
  approval: Omit<Extract<MuxFrame, { type: 'approval/requested' }>, 'type' | 'sessionId'>
  question: Omit<Extract<MuxFrame, { type: 'question/requested' }>, 'type' | 'sessionId'>
}

/** Pending-interaction discriminant (the keys of PendingPayloads). */
export type PendingKind = keyof PendingPayloads

/** Session-list summary of the user action currently blocking progress. */
export type PendingInteractionStatus = 'approval' | 'plan-review' | 'question'

/** Kind-discriminated union of concrete waits: narrowing on `kind` types `payload`. */
export type PendingInteraction = { [K in PendingKind]: PendingWait<K> }[PendingKind]

/** Key prefixes, one per kind (the key doubles as the Session pending-map key). */
const KEY_PREFIX: Record<PendingKind, string> = { approval: 'a', question: 'q' }

/**
 * One pending host-owned interaction wait: an immutable render face
 * (kind/key/sessionId/payload) plus the response carrier. respond() backfills
 * the requested frame's rpcId into a client-response envelope — no consumer
 * ever sees the raw rpcId. Settlement is expressed only by pending-list
 * membership (the settled flag is a fail-loud guard, not a render input).
 */
export class PendingWait<K extends PendingKind = PendingKind> {
  /** Interaction kind (union discriminant). */
  readonly kind: K
  /** Opaque render identity, `<prefix>:<rpcId>` — stable across baseline replay, usable as a React key. */
  readonly key: string
  /** Owning session. */
  readonly sessionId: SessionId
  /** The requested frame's domain fields, verbatim. */
  readonly payload: PendingPayloads[K]
  #settled = false
  readonly #rpcId: RpcId
  readonly #respond: (message: ClientResponse) => Promise<RpcReceipt>

  /**
   * Minted by Session on a requested frame (public construction is the test-fixture path).
   * @param kind - interaction kind.
   * @param rpcId - the requested frame's stable envelope id (kept private; respond echoes it).
   * @param sessionId - owning session.
   * @param payload - the requested frame's domain fields.
   * @param respond - the client-response carrier (api.respond).
   */
  constructor(
    kind: K, rpcId: RpcId, sessionId: SessionId, payload: PendingPayloads[K],
    respond: (message: ClientResponse) => Promise<RpcReceipt>,
  ) {
    this.kind = kind
    this.key = `${KEY_PREFIX[kind]}:${rpcId}`
    this.sessionId = sessionId
    this.payload = payload
    this.#rpcId = rpcId
    this.#respond = respond
  }

  /**
   * Send a result for this wait: wraps it into the client-response envelope
   * with the rpcId backfilled. Throws synchronously once settled.
   * @param result - the result shell (ok value / error envelope), domain-encoded by the caller.
   * @returns the carrier receipt.
   */
  respond(result: ClientResponse['result']): Promise<RpcReceipt> {
    if (this.#settled) throw new Error(`pending wait ${this.key} is already settled`)
    return this.#respond({ type: 'client-response', rpcId: this.#rpcId, result })
  }

  /** Session-only settlement mark (the authoritative resolved frame arrived); respond() throws afterwards. */
  markSettled(): void {
    this.#settled = true
  }
}
