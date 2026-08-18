import type { Context } from '@deepseek-ai/cordis'
import type {
  ConversationNodeDefinition, UnknownSurfaceNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-client-runtime/client'
import { chatNode } from './common.ts'

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    /** Generic presentation of an unclaimed append-surface event. */
    unknown: UnknownSurfaceNode
  }
}

/** Unclaimed append-surface fallback Definition. */
export const unknownFallbackDefinition: ConversationNodeDefinition<UnknownSurfaceNode> = {
  kind: 'unknown-surface',
  target: 'chat',
  match: event => isAppendSurfaceEvent(event)
    ? { id: String(event.seq), role: 'start' }
    : null,
  start: (_context, match) => ({
    kind: 'unknown',
    seq: match.event.seq,
    time: match.event.time,
    type: match.event.type,
    data: match.event.data,
  }),
  update: context => context.state,
  buildViewNode: context => context.state === undefined
    ? null
    : chatNode(context, 'unknown', context.state.seq, context.state),
}

/**
 * Register the unmatched append-surface fallback contribution.
 * @param ctx - owning UI Conversation context.
 */
export function registerUnknownConversationFallback(ctx: Context): void {
  ctx.conversationEvents.registerFallback(unknownFallbackDefinition)
}
