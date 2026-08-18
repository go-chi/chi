/**
 * Browser-safe subagent domain contract. Persisted transcript reads never
 * activate an Agent, while continuable prompts route through the exact live
 * direct parent into the child's Agent inbox.
 */

import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RpcRequest, RpcResponse } from './rpc.ts'
import type { HistoryEntry, SessionProjectionsBlock } from './sessions.ts'

/** Complete durable direct-child catalog row. */
export type SubagentListEntry =
  | {
    kind: 'child'
    id: SessionId
    /** Whether the child Agent driver is running at the Host sampling boundary. */
    activity: 'running' | 'inactive'
    /** Whether a direct descendant has durable `origin: 'subagent'`. */
    hasChildren: boolean
  } & (
    | {
      mode: 'one-shot'
      label?: string
    }
    | {
      mode: 'continuable'
      label: string
    }
  )
  | {
    kind: 'diagnostic'
    id: SessionId
    reason: 'corrupt' | 'unsupported' | 'unavailable'
  }

/** Inbox identity returned once the continuation accepts one human message. */
export interface SubagentPromptReceipt {
  messageId: MessageId
}

/** Uniform acknowledgement that one interrupt request was admitted. */
export interface SubagentInterruptReceipt {
  accepted: true
}

/** Durable parent/child address that selects subagent transport in the client. */
export type SubagentAddress =
  & {
    parentSessionId: SessionId
    childSessionId: SessionId
  }
  & (
    | { mode: 'one-shot' }
    | { mode: 'continuable' }
  )

/** Complete direct-child catalog plus the delivery-time parent availability hint. */
export interface SubagentCatalog {
  entries: SubagentListEntry[]
  parentAvailable: boolean
}

/** Subagent-domain unary methods. */
export interface SubagentsApi {
  /**
   * Lists direct session-backed children without loading either side. Parent
   * availability is a hint; continuable prompt performs the authoritative
   * check.
   */
  list(
    request: RpcRequest<{ parentSessionId: SessionId }>,
    signal?: AbortSignal,
  ): Promise<RpcResponse<SubagentCatalog>>

  /**
   * Reads one healthy catalog child's transcript — the in-memory snapshot of
   * a live child, the persisted log of a cold one — with ordinary
   * message-aligned pagination and render intents, without Agent activation.
   */
  history(
    request: RpcRequest<SubagentAddress & { beforeSeq?: number; maxMessages?: number }>,
    signal?: AbortSignal,
  ): Promise<RpcResponse<{
    events: HistoryEntry[]
    hasMore: boolean
    projections?: SessionProjectionsBlock
  }>>

  /**
   * Delivers human content to a continuable child through the exact live
   * parent's continuation owner. Success identifies the message accepted by
   * the child's FIFO inbox; later execution is independent of this request.
   * Optional browser-zone provenance is validated and logged on that message.
   */
  prompt(
    request: RpcRequest<
      Extract<SubagentAddress, { mode: 'continuable' }> & {
        content: ContentBlock[]
        /** Optional browser zone sampled for this exact human prompt. */
        clientTimeZone?: string
      }
    >,
    signal: AbortSignal,
  ): Promise<RpcResponse<SubagentPromptReceipt>>

  /**
   * Interrupts a live continuable child's current turn under the address's
   * durable direct-parent authority, without requiring a live parent Agent,
   * consulting the catalog, or resuming anything. Fire-and-return: `accepted`
   * acknowledges the admitted cancel signal, not target quiescence, so the
   * child may remain visibly running briefly. Unclaimed queued follow-ups are
   * kept and parked; an absent, idle, or already-completed target is likewise
   * `accepted`.
   */
  interrupt(
    request: RpcRequest<Extract<SubagentAddress, { mode: 'continuable' }>>,
  ): Promise<RpcResponse<SubagentInterruptReceipt>>
}
