import type { Context } from '@deepseek-ai/cordis'
import type {
  ChatConversationViewNode, ChatLocationNodeIndex, ChatNodeStore, ChatSnapshot,
  ConversationLocation, ConversationNode, ConversationTimelineSnapshot,
  ConversationViewBuilder, ConversationViewDefinition, LegacyConversationSlice,
  PartialAssistant, RunningToolCall,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatNode } from '../contract/chat-nodes.ts'
import { isRunningTool } from '../contract/chat-nodes.ts'

const EMPTY_KEYS: readonly string[] = []
const EMPTY_TURNS: readonly number[] = []
const EMPTY_LIST: readonly never[] = []

function sameReferences<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

class MutableChatNodeStore implements ChatNodeStore {
  private readonly byKey = new Map<string, ChatConversationViewNode>()
  private valuesCache: readonly ChatConversationViewNode[] = EMPTY_LIST
  private valuesDirty = false

  get(key: string): ChatConversationViewNode | undefined {
    return this.byKey.get(key)
  }

  values(): readonly ChatConversationViewNode[] {
    if (this.valuesDirty) {
      this.valuesCache = [...this.byKey.values()]
      this.valuesDirty = false
    }
    return this.valuesCache
  }

  replace(nodes: readonly ChatConversationViewNode[]): void {
    this.byKey.clear()
    for (const node of nodes) this.byKey.set(node.key, node)
    this.valuesCache = [...this.byKey.values()]
    this.valuesDirty = false
  }

  upsert(nodes: readonly ChatConversationViewNode[]): void {
    let changed = false
    for (const node of nodes) {
      if (this.byKey.get(node.key) === node) continue
      this.byKey.set(node.key, node)
      changed = true
    }
    if (changed) this.valuesDirty = true
  }
}

class MutableChatLocationIndex implements ChatLocationNodeIndex {
  private turns = new Map<number, readonly string[]>()
  private steps = new Map<string, readonly string[]>()

  getTurn(turn: number): readonly string[] {
    return this.turns.get(turn) ?? EMPTY_KEYS
  }

  getStep(turn: number, step: number): readonly string[] {
    return this.steps.get(stepKey(turn, step)) ?? EMPTY_KEYS
  }

  rebuild(order: readonly string[], store: ChatNodeStore): void {
    const turns = new Map<number, string[]>()
    const steps = new Map<string, string[]>()
    for (const key of order) {
      const location = store.get(key)?.location
      if (location === undefined) continue
      const coordinates = locationCoordinates(location)
      if (coordinates.turn === undefined) continue
      const turnKeys = turns.get(coordinates.turn) ?? []
      turnKeys.push(key)
      turns.set(coordinates.turn, turnKeys)
      if (coordinates.step === undefined) continue
      const step = stepKey(coordinates.turn, coordinates.step)
      const stepKeys = steps.get(step) ?? []
      stepKeys.push(key)
      steps.set(step, stepKeys)
    }
    this.turns = updateIndex(this.turns, turns)
    this.steps = updateIndex(this.steps, steps)
  }

  /** Invalidate aggregate readers when member data changes without moving. */
  touch(nodes: readonly ChatConversationViewNode[]): void {
    const turns = new Set<number>()
    const steps = new Set<string>()
    for (const node of nodes) {
      const coordinates = locationCoordinates(node.location)
      if (coordinates.turn === undefined || !this.turns.get(coordinates.turn)?.includes(node.key)) continue
      turns.add(coordinates.turn)
      if (coordinates.step !== undefined) steps.add(stepKey(coordinates.turn, coordinates.step))
    }
    for (const turn of turns) {
      const keys = this.turns.get(turn)
      if (keys === undefined) continue
      this.turns.set(turn, [...keys])
    }
    for (const step of steps) {
      const keys = this.steps.get(step)
      if (keys === undefined) continue
      this.steps.set(step, [...keys])
    }
  }
}

function updateIndex<Key>(
  previous: ReadonlyMap<Key, readonly string[]>,
  nextMutable: ReadonlyMap<Key, string[]>,
): Map<Key, readonly string[]> {
  const next = new Map<Key, readonly string[]>()
  const keys = new Set([...previous.keys(), ...nextMutable.keys()])
  for (const key of keys) {
    const before = previous.get(key) ?? EMPTY_KEYS
    const candidate = nextMutable.get(key) ?? EMPTY_KEYS
    const value = sameReferences(before, candidate) ? before : candidate
    if (candidate.length > 0) next.set(key, value)
  }
  return next
}

function stepKey(turn: number, step: number): string {
  return `${turn}:${step}`
}

function locationCoordinates(location: ConversationLocation): { turn?: number; step?: number } {
  if (location.kind === 'step') return { turn: location.turn.turn, step: location.step.step }
  if (location.kind === 'turn') return { turn: location.turn.turn }
  return {}
}

function orderedVisible(nodes: readonly ChatConversationViewNode[]): ChatConversationViewNode[] {
  return nodes
    .filter(node => node.visibility === 'visible')
    .sort((left, right) => left.anchorSeq - right.anchorSeq || left.key.localeCompare(right.key))
}

interface LegacyContribution {
  readonly anchorSeq: number
  readonly nodes: readonly ConversationNode[]
  readonly partial: PartialAssistant | null
  readonly running: RunningToolCall | null
}

const EMPTY_CONTRIBUTION: LegacyContribution = {
  anchorSeq: 0,
  nodes: EMPTY_LIST,
  partial: null,
  running: null,
}

function legacyContribution(raw: ChatConversationViewNode): LegacyContribution {
  const node = raw as ChatNode
  // Content-free settled Assistants remain in the finalized compatibility
  // stream so StatsLine preserves its pre-assembly step counts; hidden running
  // attempts have no final Node to contribute.
  if (raw.visibility !== 'visible' && node.kind !== 'assistant-step') return EMPTY_CONTRIBUTION
  switch (node.kind) {
    case 'user':
    case 'steering':
    case 'context':
    case 'command':
    case 'compaction':
    case 'turn-error':
    case 'turn-max-tokens':
    case 'unknown':
      return { anchorSeq: node.anchorSeq, nodes: [node.data], partial: null, running: null }
    case 'assistant-step': {
      const data = node.data
      if (data.status === 'running') {
        if (raw.visibility !== 'visible') return EMPTY_CONTRIBUTION
        return {
          anchorSeq: node.anchorSeq,
          nodes: EMPTY_LIST,
          partial: { turn: data.turn, step: data.step, blocks: data.blocks },
          running: null,
        }
      }
      return {
        anchorSeq: node.anchorSeq,
        nodes: data.finalNode === undefined ? EMPTY_LIST : [data.finalNode],
        partial: null,
        running: null,
      }
    }
    case 'tool-call': {
      const root = node.data.root
      return isRunningTool(root)
        ? { anchorSeq: node.anchorSeq, nodes: EMPTY_LIST, partial: null, running: root }
        : { anchorSeq: node.anchorSeq, nodes: [root], partial: null, running: null }
    }
    case 'manual-compaction': {
      const data = node.data
      return {
        anchorSeq: node.anchorSeq,
        nodes: data.compaction === null ? [data.command] : [data.command, data.compaction],
        partial: null,
        running: null,
      }
    }
    case 'model-retry':
      return {
        anchorSeq: node.anchorSeq,
        nodes: node.data.attempts,
        partial: null,
        running: null,
      }
    case 'turn-tail':
      return EMPTY_CONTRIBUTION
    default:
      return EMPTY_CONTRIBUTION
  }
}

function sameContribution(left: LegacyContribution | undefined, right: LegacyContribution): boolean {
  return left !== undefined
    && left.anchorSeq === right.anchorSeq
    && left.partial?.blocks === right.partial?.blocks
    && left.partial?.turn === right.partial?.turn
    && left.partial?.step === right.partial?.step
    && left.running === right.running
    && sameReferences(left.nodes, right.nodes)
}

/** Incremental compatibility projection for StatsLine and legacy top-level snapshot fields. */
class LegacySliceBuilder {
  private readonly contributions = new Map<string, LegacyContribution>()
  private readonly finalizedContributions = new Map<string, LegacyContribution>()
  private readonly runningContributions = new Map<string, LegacyContribution>()
  private readonly partialContributions = new Map<string, LegacyContribution>()
  private finalized: readonly ConversationNode[] = EMPTY_LIST
  private runningCalls: readonly RunningToolCall[] = EMPTY_LIST
  private partial: PartialAssistant | null = null
  private timeline: ConversationTimelineSnapshot | undefined
  private turnTimings: LegacyConversationSlice['turnTimings'] = new Map()
  private turnEnds: LegacyConversationSlice['turnEnds'] = new Map()

  replace(
    nodes: readonly ChatConversationViewNode[],
    timeline: ConversationTimelineSnapshot,
  ): LegacyConversationSlice {
    this.contributions.clear()
    this.finalizedContributions.clear()
    this.runningContributions.clear()
    this.partialContributions.clear()
    for (const node of nodes) {
      const contribution = legacyContribution(node)
      this.contributions.set(node.key, contribution)
      this.indexContribution(node.key, contribution)
    }
    this.rebuildFinalized()
    this.rebuildRunning()
    this.rebuildPartial()
    this.updateTimeline(timeline)
    return this.snapshot()
  }

  apply(
    upserts: readonly ChatConversationViewNode[],
    timeline: ConversationTimelineSnapshot,
  ): LegacyConversationSlice {
    let finalizedChanged = false
    let runningChanged = false
    let partialChanged = false
    for (const node of upserts) {
      const contribution = legacyContribution(node)
      const previous = this.contributions.get(node.key)
      if (sameContribution(previous, contribution)) continue
      finalizedChanged ||= finalizedContributionChanged(previous, contribution)
      runningChanged ||= runningContributionChanged(previous, contribution)
      partialChanged ||= partialContributionChanged(previous, contribution)
      this.contributions.set(node.key, contribution)
      this.indexContribution(node.key, contribution)
    }
    if (finalizedChanged) this.rebuildFinalized()
    if (runningChanged) this.rebuildRunning()
    if (partialChanged) this.rebuildPartial()
    this.updateTimeline(timeline)
    return this.snapshot()
  }

  private indexContribution(key: string, contribution: LegacyContribution): void {
    updateContributionIndex(this.finalizedContributions, key, contribution, contribution.nodes.length > 0)
    updateContributionIndex(this.runningContributions, key, contribution, contribution.running !== null)
    updateContributionIndex(this.partialContributions, key, contribution, contribution.partial !== null)
  }

  private rebuildFinalized(): void {
    const finalized = [...this.finalizedContributions.values()]
      .flatMap(value => value.nodes)
      .sort((left, right) => left.seq - right.seq)
    if (!sameReferences(this.finalized, finalized)) this.finalized = finalized
  }

  private rebuildRunning(): void {
    const runningCalls = [...this.runningContributions.values()]
      .sort((left, right) => left.anchorSeq - right.anchorSeq)
      .flatMap(value => value.running === null ? [] : [value.running])
    if (!sameReferences(this.runningCalls, runningCalls)) this.runningCalls = runningCalls
  }

  private rebuildPartial(): void {
    const partial = [...this.partialContributions.values()]
      .sort((left, right) => left.anchorSeq - right.anchorSeq)
      .findLast(value => value.partial !== null)?.partial ?? null
    if (this.partial?.blocks !== partial?.blocks
      || this.partial?.turn !== partial?.turn
      || this.partial?.step !== partial?.step) this.partial = partial
  }

  private updateTimeline(timeline: ConversationTimelineSnapshot): void {
    if (this.timeline === timeline) return
    this.timeline = timeline
    const turnTimings = new Map<number, { startTime: number; endTime?: number }>()
    const turnEnds = new Map<number, number>()
    for (const turn of timeline.turns.values()) {
      if (turn.start !== undefined) {
        turnTimings.set(turn.turn, {
          startTime: turn.start.time,
          ...turn.end === undefined ? {} : { endTime: turn.end.time },
        })
      }
      if (turn.end !== undefined) turnEnds.set(turn.turn, turn.end.seq)
    }
    this.turnTimings = turnTimings
    this.turnEnds = turnEnds
  }

  private snapshot(): LegacyConversationSlice {
    return {
      nodes: this.finalized,
      turnTimings: this.turnTimings,
      turnEnds: this.turnEnds,
      partial: this.partial,
      runningCalls: this.runningCalls,
    }
  }
}

function updateContributionIndex(
  index: Map<string, LegacyContribution>,
  key: string,
  contribution: LegacyContribution,
  present: boolean,
): void {
  if (present) index.set(key, contribution)
  else index.delete(key)
}

function finalizedContributionChanged(
  previous: LegacyContribution | undefined,
  next: LegacyContribution,
): boolean {
  const previousNodes = previous?.nodes ?? EMPTY_LIST
  return !sameReferences(previousNodes, next.nodes)
    || ((previousNodes.length > 0 || next.nodes.length > 0) && previous?.anchorSeq !== next.anchorSeq)
}

function runningContributionChanged(
  previous: LegacyContribution | undefined,
  next: LegacyContribution,
): boolean {
  return previous?.running !== next.running
    || ((previous.running !== null || next.running !== null)
      && previous.anchorSeq !== next.anchorSeq)
}

function partialContributionChanged(
  previous: LegacyContribution | undefined,
  next: LegacyContribution,
): boolean {
  return previous?.partial?.blocks !== next.partial?.blocks
    || previous?.partial?.turn !== next.partial?.turn
    || previous?.partial?.step !== next.partial?.step
    || (((previous?.partial ?? null) !== null || next.partial !== null)
      && previous?.anchorSeq !== next.anchorSeq)
}

/** Incremental keyed Chat builder registered under the `chat` target. */
export class ChatSnapshotBuilder implements ConversationViewBuilder<ChatConversationViewNode, ChatSnapshot> {
  private readonly store = new MutableChatNodeStore()
  private readonly locations = new MutableChatLocationIndex()
  private readonly legacy = new LegacySliceBuilder()
  private order: readonly string[] = EMPTY_KEYS
  readonly empty: ChatSnapshot

  constructor() {
    this.empty = this.snapshot({ turnOrder: EMPTY_TURNS, turns: new Map() })
  }

  replace(input: {
    readonly nodes: readonly ChatConversationViewNode[]
    readonly timeline: ConversationTimelineSnapshot
  }): ChatSnapshot {
    this.store.replace(input.nodes)
    this.order = orderedVisible(input.nodes).map(node => node.key)
    this.locations.rebuild(this.order, this.store)
    return this.snapshot(input.timeline, this.legacy.replace(input.nodes, input.timeline))
  }

  apply(input: {
    readonly upserts: readonly ChatConversationViewNode[]
    readonly timeline: ConversationTimelineSnapshot
  }): ChatSnapshot {
    let structural = false
    const contentOnly: ChatConversationViewNode[] = []
    for (const node of input.upserts) {
      const previous = this.store.get(node.key)
      const nodeStructural = previous === undefined
        || previous.anchorSeq !== node.anchorSeq
        || previous.visibility !== node.visibility
        || locationIdentity(previous.location) !== locationIdentity(node.location)
      structural ||= nodeStructural
      if (!nodeStructural) contentOnly.push(node)
    }
    this.store.upsert(input.upserts)
    if (structural) {
      const next = orderedVisible(this.store.values()).map(node => node.key)
      this.order = sameReferences(this.order, next) ? this.order : next
      this.locations.rebuild(this.order, this.store)
    }
    this.locations.touch(contentOnly)
    return this.snapshot(input.timeline, this.legacy.apply(input.upserts, input.timeline))
  }

  private snapshot(
    timeline: ConversationTimelineSnapshot,
    legacy = this.legacy.replace(EMPTY_LIST, timeline),
  ): ChatSnapshot {
    return {
      order: this.order,
      nodes: this.store,
      locations: this.locations,
      timeline,
      legacy,
    }
  }
}

function locationIdentity(location: ConversationLocation): string {
  const coordinates = locationCoordinates(location)
  return `${location.kind}:${coordinates.turn ?? ''}:${coordinates.step ?? ''}`
}

/** Chat target factory contributed to the Runtime view registry. */
export const chatViewDefinition: ConversationViewDefinition<ChatConversationViewNode, ChatSnapshot> = {
  target: 'chat',
  create: () => new ChatSnapshotBuilder(),
}

/**
 * Register the incremental Chat target builder.
 * @param ctx - owning UI Conversation context.
 */
export function registerChatConversationView(ctx: Context): void {
  ctx.conversationViews.register(chatViewDefinition)
}
