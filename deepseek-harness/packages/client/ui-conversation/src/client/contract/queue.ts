/** Queue contracts derived from the runtime session face and snapshot. */
import type {
  ConversationSnapshot, SessionFace,
} from '@deepseek-ai/dsh-client-runtime/client'

/** One address accepted by the runtime session's queue mutation verb. */
export type QueueItemId = Parameters<SessionFace['updateQueue']>[0]

/** One mutation accepted by the runtime session's queue mutation verb. */
export type QueueAction = Parameters<SessionFace['updateQueue']>[1]

/** One row projected by the runtime session's authoritative queue snapshot. */
export type QueueRow = ConversationSnapshot['queue'][number]
