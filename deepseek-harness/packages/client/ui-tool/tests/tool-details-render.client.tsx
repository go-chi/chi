/** Test adapter for the production conversation.details.tool registration. */
import type {
  ChatConversationViewNode, ChatSnapshot, ConversationNode, RunningToolCall, SessionId,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionProviderComponent, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { DetailsSlotProps, DetailsToolOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/src/client/contract/slots.ts'
import { ToolDetails } from '../src/client/tool/ToolDetails.tsx'

/** Framework session-area seat used by direct DetailsPanel tests. */
export const SessionProviderStub: SessionProviderComponent = ({ children }) => children('s1' as SessionId)

/** Build the canonical Chat slice consumed by Tool rows and details tests. */
export function toolChatSnapshot(
  settled: readonly ConversationNode[] = [],
  running: readonly RunningToolCall[] = [],
): ChatSnapshot {
  const roots = [...settled.filter(node => node.kind === 'tool-result'), ...running]
  const nodes: ChatConversationViewNode[] = roots.map(root => ({
    key: `tool:${root.callId}`,
    kind: 'tool-call',
    id: root.callId,
    target: 'chat',
    anchorSeq: 'kind' in root ? root.seq : Number.MAX_SAFE_INTEGER,
    location: { kind: 'session' },
    visibility: 'visible',
    data: { root },
  }))
  const byKey = new Map(nodes.map(node => [node.key, node]))
  const empty: readonly string[] = []
  return {
    order: nodes.map(node => node.key),
    nodes: {
      get: key => byKey.get(key),
      values: () => nodes,
    },
    locations: {
      getTurn: () => empty,
      getStep: () => empty,
    },
    timeline: { turnOrder: [], turns: new Map() },
    legacy: {
      nodes: settled,
      runningCalls: running,
      partial: null,
      turnTimings: new Map(),
      turnEnds: new Map(),
    },
  }
}

/**
 * Bind ui-tool's details renderer to the conversation slot callback shape.
 * @param t - conversation locale seat used by Tool cards.
 * @returns a direct-test renderSlot implementation.
 */
export function renderToolDetails(t: TranslateNS<'conversation'>): DetailsSlotProps['renderSlot'] {
  return (_key, owner) => {
    // PropsRenderSlots keeps its key generic even for this one-key share;
    // recover the concrete owner selected by the adapter's fixed slot.
    const details = owner as unknown as DetailsToolOwnerProps
    return <ToolDetails block={details.block} cwd={details.cwd} t={t} />
  }
}
