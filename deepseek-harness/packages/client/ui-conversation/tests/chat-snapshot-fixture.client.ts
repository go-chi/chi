import type {
  AssistantMessageNode, ChatConversationViewNode, ChatSnapshot, ConversationNode,
  ChatLocationNodeIndex, ChatNodeStore, CompactionSummaryNode, ConversationLocationDataStore,
  ConversationTurnDataMap, LegacyConversationSlice, PartialAssistant, RunningToolCall,
  ToolCallBlock, TurnLocation,
} from '@deepseek-ai/dsh-client-runtime/client'
import { deriveTurnMetrics } from '../src/client/chat/turn-metrics.ts'

const EMPTY: readonly never[] = []

function sameValues<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function nodeSource(node: ChatConversationViewNode): unknown {
  if (node.kind === 'assistant-step') {
    const data = node.data as ReturnType<typeof assistantData>
    return data.finalNode ?? data.blocks
  }
  if (node.kind === 'tool-call') return (node.data as { readonly root: ToolCallBlock }).root
  if (node.kind === 'model-retry') return (node.data as { readonly current: unknown }).current
  if (node.kind === 'turn-tail') return (node.data as { readonly seq: number }).seq
  return node.data
}

class FixtureNodeStore implements ChatNodeStore {
  private byKey = new Map<string, ChatConversationViewNode>()
  private list: readonly ChatConversationViewNode[] = EMPTY

  get(key: string): ChatConversationViewNode | undefined {
    return this.byKey.get(key)
  }

  values(): readonly ChatConversationViewNode[] {
    return this.list
  }

  replace(candidates: readonly ChatConversationViewNode[]): void {
    const next = new Map<string, ChatConversationViewNode>()
    const list = candidates.map((candidate) => {
      const previous = this.byKey.get(candidate.key)
      const node = previous !== undefined
        && previous.kind === candidate.kind
        && previous.anchorSeq === candidate.anchorSeq
        && previous.visibility === candidate.visibility
        && nodeSource(previous) === nodeSource(candidate)
        ? previous
        : candidate
      next.set(node.key, node)
      return node
    })
    this.byKey = next
    this.list = sameValues(this.list, list) ? this.list : list
  }
}

class FixtureLocationIndex implements ChatLocationNodeIndex {
  private turns = new Map<number, readonly string[]>()

  getTurn(turn: number): readonly string[] {
    return this.turns.get(turn) ?? EMPTY
  }

  getStep(): readonly string[] {
    return EMPTY
  }

  replace(next: ReadonlyMap<number, readonly string[]>): void {
    const stable = new Map<number, readonly string[]>()
    for (const [turn, keys] of next) {
      const previous = this.turns.get(turn) ?? EMPTY
      stable.set(turn, sameValues(previous, keys) ? previous : keys)
    }
    this.turns = stable
  }
}

class FixtureTurnDataStore implements ConversationLocationDataStore<ConversationTurnDataMap> {
  private readonly values = new Map<string, unknown>()

  get<Key extends Extract<keyof ConversationTurnDataMap, string>>(
    key: Key,
  ): Readonly<ConversationTurnDataMap[Key]> | undefined {
    return this.values.get(key) as Readonly<ConversationTurnDataMap[Key]> | undefined
  }

  set<Key extends Extract<keyof ConversationTurnDataMap, string>>(
    key: Key,
    value: ConversationTurnDataMap[Key],
  ): void {
    this.values.set(key, value)
  }
}

function assistantData(node: AssistantMessageNode) {
  return {
    status: node.interrupted === true ? 'interrupted' as const : 'settled' as const,
    turn: node.turn,
    step: node.step,
    blocks: node.blocks,
    time: node.time,
    finalNode: node,
  }
}

function settledNode(
  node: ConversationNode,
  turns: ReadonlyMap<number, TurnLocation>,
): ChatConversationViewNode {
  const turn = 'turn' in node && typeof node.turn === 'number' ? turns.get(node.turn) : undefined
  const base = {
    key: `fixture:${node.kind}:${node.seq}`,
    id: String(node.seq),
    target: 'chat' as const,
    anchorSeq: node.seq,
    location: turn === undefined
      ? { kind: 'session' as const }
      : { kind: 'turn' as const, turn },
    visibility: 'visible' as const,
  }
  switch (node.kind) {
    case 'assistant':
      return { ...base, kind: 'assistant-step', data: assistantData(node) }
    case 'tool-result':
      return { ...base, key: `fixture:tool:${node.callId}`, kind: 'tool-call', data: { root: node } }
    case 'model-retry':
      return { ...base, key: 'fixture:model-retry', kind: 'model-retry', data: { attempts: [node], current: node } }
    default:
      return { ...base, kind: node.kind, data: node }
  }
}

/** Build the canonical Chat fixture corresponding to one legacy test slice. */
export function chatSnapshotFixture(input: {
  readonly nodes?: readonly ConversationNode[]
  readonly partial?: PartialAssistant | null
  readonly runningCalls?: readonly RunningToolCall[]
  readonly turnTimings?: LegacyConversationSlice['turnTimings']
  readonly turnEnds?: LegacyConversationSlice['turnEnds']
} = {}, previous?: ChatSnapshot): ChatSnapshot {
  const legacy: LegacyConversationSlice = {
    nodes: input.nodes ?? EMPTY,
    partial: input.partial ?? null,
    runningCalls: input.runningCalls ?? EMPTY,
    turnTimings: input.turnTimings ?? new Map(),
    turnEnds: input.turnEnds ?? new Map(),
  }
  const turnNumbers = new Set([...legacy.turnTimings.keys(), ...legacy.turnEnds.keys()])
  for (const node of legacy.nodes) {
    if ('turn' in node && typeof node.turn === 'number') turnNumbers.add(node.turn)
  }
  if (legacy.partial !== null) turnNumbers.add(legacy.partial.turn)
  for (const call of legacy.runningCalls) turnNumbers.add(call.turn)
  const turns = new Map<number, TurnLocation>()
  const turnData = new Map<number, FixtureTurnDataStore>()
  for (const turn of [...turnNumbers].sort((left, right) => left - right)) {
    const timing = legacy.turnTimings.get(turn)
    const endSeq = legacy.turnEnds.get(turn)
    const data = new FixtureTurnDataStore()
    turnData.set(turn, data)
    turns.set(turn, {
      turn,
      start: timing === undefined ? undefined : {
        type: 'turn/start', seq: Math.max(0, (endSeq ?? 1) - 1), time: timing.startTime, turn,
      } as never,
      end: timing?.endTime === undefined || endSeq === undefined ? undefined : {
        type: 'turn/end', seq: endSeq, time: timing.endTime, turn, reason: 'completed',
      } as never,
      status: endSeq === undefined ? 'open' : 'closed',
      steps: EMPTY,
      data,
    })
  }
  const linkedCompactions = new Set<CompactionSummaryNode>()
  const nodes = legacy.nodes.flatMap((node): ChatConversationViewNode[] => {
    if (node.kind === 'command' && node.name === 'compact') {
      const sourceSeq = node.outcome?.kind === 'success' ? node.outcome.sourceEventSeq : undefined
      const candidates = sourceSeq === undefined
        ? []
        : legacy.nodes.filter((candidate): candidate is CompactionSummaryNode =>
          candidate.kind === 'compaction' && candidate.summaryEventSeq === sourceSeq)
      const compaction = candidates.length === 1 ? candidates[0] : undefined
      if (node.outcome === null || compaction !== undefined) {
        if (compaction !== undefined) linkedCompactions.add(compaction)
        const base = settledNode(node, turns)
        return [{
          ...base,
          key: `fixture:manual-compaction:${node.commandId}`,
          kind: 'manual-compaction',
          anchorSeq: compaction?.seq ?? node.seq,
          data: { command: node, compaction: compaction ?? null },
        }]
      }
    }
    if (node.kind === 'compaction' && linkedCompactions.has(node)) return []
    return [settledNode(node, turns)]
  })
  if (legacy.partial !== null) {
    const turn = turns.get(legacy.partial.turn)
    nodes.push({
      key: `fixture:assistant:${legacy.partial.turn}:${legacy.partial.step}`,
      id: `${legacy.partial.turn}:${legacy.partial.step}`,
      target: 'chat',
      kind: 'assistant-step',
      anchorSeq: Number.MAX_SAFE_INTEGER - 1,
      location: turn === undefined ? { kind: 'session' } : { kind: 'turn', turn },
      visibility: 'visible',
      data: {
        status: 'running',
        turn: legacy.partial.turn,
        step: legacy.partial.step,
        blocks: legacy.partial.blocks,
        time: 0,
      },
    })
  }
  for (const call of legacy.runningCalls) {
    const turn = turns.get(call.turn)
    nodes.push({
      key: `fixture:tool:${call.callId}`,
      id: call.callId,
      target: 'chat',
      kind: 'tool-call',
      anchorSeq: Number.MAX_SAFE_INTEGER,
      location: turn === undefined ? { kind: 'session' } : { kind: 'turn', turn },
      visibility: 'visible',
      data: { root: call },
    })
  }
  for (const [turnNumber, endSeq] of legacy.turnEnds) {
    const turn = turns.get(turnNumber)
    const dataStore = turnData.get(turnNumber)
    if (turn === undefined || dataStore === undefined) continue
    const closing = legacy.nodes
      .filter((candidate): candidate is AssistantMessageNode => candidate.kind === 'assistant'
        && candidate.turn === turnNumber
        && candidate.blocks.some(block => block.kind === 'text' && block.text.trim() !== ''))
      .map(assistantData)
      .at(-1) ?? null
    const preceding = nodes.findLast((candidate) => {
      const location = candidate.location
      return (location.kind === 'turn' || location.kind === 'step')
        && location.turn.turn === turnNumber
    })
    const metrics = deriveTurnMetrics(legacy.nodes).get(turnNumber)
    const tailData = {
      turn: turnNumber,
      seq: endSeq,
      time: turn.end?.time ?? 0,
      closing,
      branchUnavailable: closing === null
        || preceding?.kind !== 'assistant-step'
        || (preceding.data as ReturnType<typeof assistantData>).finalNode.seq !== closing.finalNode.seq,
      ...metrics?.ttftMs === undefined ? {} : { ttftMs: metrics.ttftMs },
      ...metrics?.tokensPerSecond === undefined ? {} : { tokensPerSecond: metrics.tokensPerSecond },
    }
    dataStore.set('turn-tail', tailData)
    nodes.push({
      key: `fixture:turn-tail:${turnNumber}`,
      id: String(turnNumber),
      target: 'chat',
      kind: 'turn-tail',
      anchorSeq: endSeq,
      location: { kind: 'turn', turn },
      visibility: 'visible',
      data: tailData,
    })
  }
  const store = previous?.nodes instanceof FixtureNodeStore ? previous.nodes : new FixtureNodeStore()
  store.replace(nodes)
  const byKey = new Map(store.values().map(node => [node.key, node]))
  const nextOrder = nodes.map(node => node.key)
  const order = previous !== undefined && sameValues(previous.order, nextOrder) ? previous.order : nextOrder
  const byTurn = new Map<number, readonly string[]>()
  for (const turn of turns.keys()) {
    byTurn.set(turn, order.filter((key) => {
      const location = byKey.get(key)?.location
      return location?.kind === 'turn' && location.turn.turn === turn
        || location?.kind === 'step' && location.turn.turn === turn
    }))
  }
  const locations = previous?.locations instanceof FixtureLocationIndex
    ? previous.locations
    : new FixtureLocationIndex()
  locations.replace(byTurn)
  const timeline = previous !== undefined
    && previous.legacy.turnTimings === legacy.turnTimings
    && previous.legacy.turnEnds === legacy.turnEnds
    ? previous.timeline
    : { turnOrder: [...turns.keys()], turns }
  return {
    order,
    nodes: store,
    locations,
    timeline,
    legacy,
  }
}
