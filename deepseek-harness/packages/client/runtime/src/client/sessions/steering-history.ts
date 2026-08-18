/** Reconstruct durable steering identity from the event-sourced agent inbox. */

import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { InboxTarget } from '@deepseek-ai/dsh-agent/types'

/** Minimal pending identity retained while replaying durable inbox splices. */
interface PendingIdentity {
  readonly id: string
}

/** Client-side structural view of the host-owned inbox event. */
interface InboxSplice {
  readonly target: InboxTarget
  readonly start: number
  readonly removedCount?: number
  readonly inserted: readonly PendingIdentity[]
  readonly outcome?: 'canceled'
}

/**
 * Incrementally identifies `user/message` events claimed from the next-step
 * inbox. The agent loop records all admitted input as `user/message`; the
 * preceding `agent/inbox/spliced` events preserve whether it came from the
 * queued-turn list or the next-step list.
 */
export class SteeringHistory {
  private readonly inbox: Record<InboxTarget, PendingIdentity[]> = {
    'next-turn': [],
    'next-step': [],
  }

  private readonly claimedNextStep = new Set<string>()

  /** Clear all replay state before rebuilding a history window. */
  reset(): void {
    this.inbox['next-turn'] = []
    this.inbox['next-step'] = []
    this.claimedNextStep.clear()
  }

  /**
   * Apply one event and report whether it is a durable human steering message.
   * @param event - next raw session event in sequence order.
   * @returns true only for a user-origin message previously claimed from `next-step`.
   */
  apply(event: SessionEvent): boolean {
    if (event.type === 'agent/inbox/spliced') {
      this.applySplice(event.data)
      return false
    }
    if (event.type !== 'user/message') return false
    const id = event.data.id
    if (!this.claimedNextStep.delete(id)) return false
    return event.data.source.kind === 'user'
  }

  /** Replay one host-validated inbox splice. */
  private applySplice({ target, start, removedCount = 0, inserted, outcome }: InboxSplice): void {
    const removed = this.inbox[target].splice(start, removedCount, ...inserted)
    for (const identity of inserted) this.claimedNextStep.delete(identity.id)
    if (target !== 'next-step' || outcome === 'canceled') return
    for (const identity of removed) this.claimedNextStep.add(identity.id)
  }
}
