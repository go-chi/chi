# Add a Web Client conversation node

English | [中文](adding-a-conversation-node.zh.md)

This tutorial adds one business-owned row to the Web Client Chat view. The finished plugin correlates a durable Session event family into one Context, incrementally builds business State, publishes typed Step data, and renders a keyed Chat Node without scanning the Session window or other rendered nodes. It assumes the Host already records the events and the client plugin is composed into the Web bundle; external Host-side UIs and additional view targets such as Trajectory are outside this tutorial.

The [Conversation Node assembly decision](../../.agents/notes/implemented/architecture/2026-08-09-client-conversation-node-assembly.md) owns the rationale and complete engine model. This guide covers the implementation path.

## 1. Design a replayable event family

Choose one stable business id before writing the Definition. Every event that contributes to the same Node must carry that id or derive it independently from its own payload; the client must never assign an update to “the latest unfinished” Context.

For a review job, the event contract could be:

| Event | Role | Required durable facts |
|---|---|---|
| `review/start` | unique start | `reviewId`, Turn/Step coordinates, title |
| `review/progress` | update | the same `reviewId`, coordinates, replayable progress |
| `review/end` | update | the same `reviewId`, coordinates, final summary |

Use the producer-owned branded id type across the process boundary. Put the `SessionEventMap` merge and payload types on the producer's type-only export, then import that export for side effects from the client package. Each `(kind, id)` may have at most one start event. A single-event business can use the event's stable identity, such as `event.seq`, as its Definition-local id.

Incremental events are supported. Prefer whole-value checkpoints when the producer can emit them cheaply, because they remain useful when the start is outside the loaded window. Each delta must carry the stable id and produce deterministic State when replayed in ascending log `seq`; it must not depend on live-only memory. If the current history window contains only updates, the assembler keeps a pending Context and builds no State until an older page supplies the start. If the product must render before the start is loaded, a terminal or checkpoint event must carry enough whole fallback state for the Definition to build that result directly; do not recover it by scanning unrelated events.

## 2. Implement the Definition and typed Chat payload

The example keeps the producer declarations and client contribution in one block so the complete relationship is visible. In a package family, keep the branded id and `SessionEventMap` declaration with the event producer, and keep the Definition, Chat data merge, and renderer in the client plugin.

```ts ignore-check
import { createElement } from 'react'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type {
  ClientContext, ConversationLocation, ConversationNodeContext,
  ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'

type ReviewId = Branded<'ReviewId'>

interface ReviewStartData {
  readonly reviewId: ReviewId
  readonly turn: number
  readonly step: number
  readonly title: string
}

interface ReviewProgressData {
  readonly reviewId: ReviewId
  readonly turn: number
  readonly step: number
  readonly completed: number
}

interface ReviewEndData {
  readonly reviewId: ReviewId
  readonly turn: number
  readonly step: number
  readonly summary: string
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Opens one durable review job.
     * @mode emit
     * @param data - stable identity, location, and initial display state.
     */
    'review/start': ReviewStartData
    /**
     * Records replayable progress for one review job.
     * @mode emit
     * @param data - stable identity, location, and latest progress.
     */
    'review/progress': ReviewProgressData
    /**
     * Closes one review job with its final summary.
     * @mode emit
     * @param data - stable identity, location, and final display state.
     */
    'review/end': ReviewEndData
  }
}

interface ReviewChatData {
  readonly title: string
  readonly completed: number
  readonly status: 'running' | 'completed'
  readonly summary?: string
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    'review-job': ReviewChatData
  }
}

declare module '@deepseek-ai/dsh-client-runtime/client' {
  interface ConversationStepDataMap {
    'review-job': ReviewChatData
  }
}

interface ReviewState extends ReviewChatData {
  readonly turn: number
  readonly step: number
}

function locationOf(context: ConversationNodeContext): ConversationLocation {
  return context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' }
}

function viewData(state: ReviewState): ReviewChatData {
  return {
    title: state.title,
    completed: state.completed,
    status: state.status,
    ...state.summary === undefined ? {} : { summary: state.summary },
  }
}

const reviewDefinition: ConversationNodeDefinition<ReviewState> = {
  kind: 'review-job',
  target: 'chat',
  match: (event) => {
    if (event.type === 'review/start') {
      return { id: String(event.data.reviewId), role: 'start' }
    }
    if (event.type === 'review/progress' || event.type === 'review/end') {
      return { id: String(event.data.reviewId), role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'review/start') throw new Error('review-job requires review/start')
    return {
      turn: match.event.data.turn,
      step: match.event.data.step,
      title: match.event.data.title,
      completed: 0,
      status: 'running',
    }
  },
  update: (context, match) => {
    if (match.event.type === 'review/progress') {
      return { ...context.state, completed: match.event.data.completed }
    }
    if (match.event.type === 'review/end') {
      return { ...context.state, completed: 100, status: 'completed', summary: match.event.data.summary }
    }
    return context.state
  },
  publication: match => match.event.type === 'review/progress'
    ? 'animation-frame'
    : 'immediate',
  buildLocationData: (context, scope) => {
    if (scope !== 'step' || context.state === undefined) return null
    return {
      kind: 'step',
      turn: context.state.turn,
      step: context.state.step,
      key: 'review-job',
      value: viewData(context.state),
    }
  },
  buildViewNode: (context) => {
    if (context.state === undefined) return null
    return {
      key: context.key,
      kind: 'review-job',
      id: context.id,
      target: 'chat',
      anchorSeq: context.start?.event.seq ?? context.matches[0]?.event.seq ?? 0,
      location: locationOf(context),
      visibility: 'visible',
      data: viewData(context.state),
    }
  },
}

function ReviewNodeView({ node }: ChatNodeViewProps<'review-job'>) {
  const text = node.data.summary ?? `${node.data.title}: ${node.data.completed}%`
  return createElement('p', null, text)
}

export const inject = ['conversationEvents', 'slots']

export function apply(ctx: ClientContext): void {
  ctx.conversationEvents.register(reviewDefinition)
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'review-job',
  }, ReviewNodeView))
}
```

`match(event)` is an identity extractor, not a fold: it receives only the current event and returns the Definition-local id and lifecycle role. After a match, the assembler locates the Context by `(kind, id)` and calls `start` once or `update` with the current State. Both functions return the State that the engine adopts; returning a new immutable value is preferred, but a function that mutates and returns the same object has the same adoption semantics.

`buildLocationData(context, scope)` optionally publishes Definition-owned data onto an engine-owned Turn or Step. Use declaration merging to give each key a precise value type. Another Node in the same Location can consume that value through its constrained slot hook, such as `useTurnData(key)`, without receiving the Session or scanning `snapshot.chat.nodes`.

`target` and `buildViewNode(context)` declare one target-owned rendering contribution and must appear together. Preserve `context.key` as the React-facing identity, choose `anchorSeq` from durable ordering evidence, and return only renderer-ready data. Once a target Node has been published, keep returning the same key; use `visibility: 'hidden'` when it must temporarily leave the visible flow rather than withdrawing it with `null`.

## 3. Query an earlier business Context only at start

Some Definitions need the latest earlier State of another business kind. `start` receives a `ConversationContextReader`; call `reader.previous<State>(kind)` there instead of accepting a Context collection or scanning events. The reader returns the nearest started Context before the current start `seq` as read-only data.

The assembler records that dependency. If an older prepend later supplies a nearer predecessor, closes a previously unknown window gap, or revises the predecessor State, it reruns the dependent Context from `start` and replays its updates in ascending `seq`. The queried Definition remains responsible for writing useful State; the reader exposes no business-specific query methods and grants no mutation authority over another Context.

## 4. Understand the three ingestion paths

History may be requested from the tail backward one page at a time, but every accepted page is normalized into ascending `seq` before State replay.

| Path | Engine work | Definition-visible behavior |
|---|---|---|
| Replace on open, resync, or gap repair | Rebuild the loaded window, match every event once per Definition, then replay each started Context | `start`, followed by its updates in ascending `seq`; pending update-only Contexts remain without State |
| Prepend one older page | Match only fresh older events, merge them into Contexts by `(kind, id)`, preserve existing keyed nodes, and replay only affected Contexts and dependencies | A newly found start activates its collected updates; a changed Location or predecessor may rerun the Context |
| Append one live event | Call each Definition's `match` once, look up the matched Context by key, and update only that Context | One `update` and one requested publication for a matching post-start event; no existing Context scan |

With `D` registered Definitions, one incoming event performs `D` current-event matches and constant-time Context-key lookup after a match. Definition code must preserve that property: do not traverse the complete event window, every Context, `context.matches`, or the rendered Node collection on the normal append path. Use State for accumulated facts, Location data for same-Turn/Step sharing, and `reader.previous()` for indexed predecessor dependencies.

`publication` controls when changed State is materialized. Use `immediate` for structural or terminal changes, `animation-frame` for high-frequency visible deltas, and `none` when the State change feeds only a later publication. The engine still applies every update in log order; cadence only coalesces view publication.

## 5. Verify replay, pagination, and rendering

Add focused tests that establish these outcomes:

1. A complete window passed through replace produces the expected final State, Location data, Node payload, and `anchorSeq`.
2. An update-only tail stays pending; prepending the unique start produces the same result as a complete replace.
3. Initial history followed by live append produces the same result as replaying the combined window.
4. Prepending an older page adds earlier rows without replacing existing keyed Node values whose data did not change.
5. Repeated visible deltas preserve `context.key` and publish at most once per animation frame when requested.
6. The keyed renderer consumes `node.data` and constrained Location hooks only; it does not scan the Session event window, Contexts, or Chat Nodes.

Use [`packages/client/ui-conversation/src/client/conversation-nodes/assistant.ts`](../../packages/client/ui-conversation/src/client/conversation-nodes/assistant.ts) for streaming and interruption, [`inbox.ts`](../../packages/client/ui-conversation/src/client/conversation-nodes/inbox.ts) plus [`message.ts`](../../packages/client/ui-conversation/src/client/conversation-nodes/message.ts) for predecessor queries, and [`packages/client/ui-deliverables`](../../packages/client/ui-deliverables) for a Definition that publishes Turn data without creating its own Node.
