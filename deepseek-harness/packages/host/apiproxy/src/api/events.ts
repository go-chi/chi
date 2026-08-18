/**
 * events domain contract: signatures and frame unions for the two logical
 * streams. Four-quadrant: streams yield the narrow form `RpcRequest<Frame>` (server-request
 * view) — rpcId must be exposed to the business layer, because responses to answerable frames
 * (approval/question requested) echo it; for pure pushes it identifies that one push.
 * signal is a local stream-control parameter, independent of the request (never on the wire).
 */

import type { AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions/types'
import type { ApprovalOutcome, ApprovalRequestId } from '@deepseek-ai/dsh-user-approval/types'
import type { Message } from '@deepseek-ai/dsh-llm/types'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { CallId } from '@deepseek-ai/dsh-llm/brand'
import type { JsonValue, SessionEvent, SessionId } from '@deepseek-ai/dsh-session/types'
import type { ToolCallView, ToolResultView } from '@deepseek-ai/dsh-tools/presentation'
import type { RpcError, RpcId, RpcRequest } from './rpc.ts'
import type { JobView } from './jobs.ts'
import type { WorkspaceView } from './workspace.ts'

// Client-side consumers take the render-intent vocabulary from the contract;
// dsh-tools remains its owner.
export type { ToolCallView, ToolResultView } from '@deepseek-ai/dsh-tools/presentation'

/**
 * Host-computed render intent accompanying a `tool/call` or `tool/result`
 * event. A pure derivation of args/result through the presenter registered at
 * emission time — never persisted (the session log carries only the event), so
 * the same event may carry a different view (or none) on a later delivery.
 * `for` names which vocabulary applies without re-inspecting the event type.
 * An absent view means the client's documented default (generic JSON card).
 */
export type ToolEventView =
  | { for: 'call'; view: ToolCallView }
  | { for: 'result'; view: ToolResultView }

/** One pending inbox occurrence in the authoritative `session/queue` snapshot. */
export interface QueuedInboxItem {
  /** Message identity used by inbox mutations. */
  id: MessageId
  /** Agent-resolved FIFO placement; queued and steering items render on different surfaces, context items stay invisible until claimed. */
  placement: 'queued' | 'steering' | 'context'
  /** Complete pending message; it is not durable until the Agent claims it. */
  message: Message
}

/** Streaming face of the contract: the two logical stream openers (mux + host). */
export interface EventsApi {
  /**
   * All-session aggregated mux stream. On open, emits a subscribed control frame for every
   * attached session, then replays each session's still-pending approval/question requested
   * frames (rpcId reused verbatim — the refresh-recovery baseline). Session titles ride the
   * generic projection pair (history-tail projections block + session/projection frames).
   * since: resume hook, unimplemented in v1 (ignored if passed); reconnection = reopen the
   * stream + refetch history.
   */
  mux(request: RpcRequest<{ since?: Record<SessionId, number> }>, signal: AbortSignal): AsyncIterable<RpcRequest<MuxFrame>>

  /**
   * Host-level info stream: session create/destroy, running-status flips, and
   * agent failures with no turn position. Empty payload uses `{}`.
   */
  host(request: RpcRequest<{}>, signal: AbortSignal): AsyncIterable<RpcRequest<HostFrame>>
}

/**
 * Mux stream frames: raw session-event passthrough + control frames +
 * approval/question frames (requested = answerable server-request, the rest are pure pushes).
 */
export type MuxFrame =
  | { type: 'session/event'; sessionId: SessionId; event: SessionEvent; view?: ToolEventView }
  | { type: 'session/subscribed'; sessionId: SessionId; lastSeq: number }
  | { type: 'approval/requested'; sessionId: SessionId; approvalId: ApprovalRequestId; toolName: string; callId?: CallId; reason?: string }
  | { type: 'approval/resolved'; sessionId: SessionId; approvalId: ApprovalRequestId; outcome: ApprovalOutcome }
  | { type: 'question/requested'; sessionId: SessionId; questions: AskUserQuestionItem[] }
  | { type: 'question/resolved'; sessionId: SessionId; questionRpcId: RpcId; outcome: 'answered' | 'cancelled' }
  /**
   * Complete transient inbox state after every enqueue, mutation, claim, or
   * discard. Pending work is not model-visible and therefore has no durable
   * session event; the whole snapshot makes edit, deletion, cancel, and
   * reconnect converge through one authoritative signal. `session/queue`
   * covers both resolved placements: queued items render
   * in QueueDock, while pending steering renders at the conversation tail.
   */
  | { type: 'session/queue'; sessionId: SessionId; items: QueuedInboxItem[] }
  /**
   * Complete set of background jobs this session can see, after every registry
   * commit that changes it: registration, the stopping transition, settlement,
   * and owner-disposal removal. The registry is process-local and holds no
   * durable event, so — exactly like `session/queue` — the whole snapshot is
   * what makes a start, a kill, a reconnect, and a second tab converge on one
   * authoritative value.
   *
   * Sent as a subscription baseline only for a session that currently has
   * tasks; an absent key means an empty set. A change that empties the set
   * still sends `[]`, since that transition is the only one absence cannot
   * express.
   */
  | { type: 'session/jobs'; sessionId: SessionId; jobs: JobView[] }
  /**
   * One projection unit's finished value changed (session-projection RFC).
   * Live push state, never logged — replay recomputes on the host (the
   * tool-view posture). `value` is the unit's schema-validated view output;
   * `seq` is the unit's watermark at emission. Clients keep one generic
   * per-session value store under higher-seq-wins, seeded by the history
   * tail page's projections block.
   */
  | { type: 'session/projection'; sessionId: SessionId; key: string; value: unknown; seq: number }
  | { type: 'stream/error'; error: RpcError }

/**
 * Host stream frames. session-added carries the lineage anchor, product
 * origin, project cwd, and blank bit (the list-summary fields a client cannot
 * wait for a refresh to learn); the frame fires at session/created, so blank is
 * constantly true — clients flip it on the session's first
 * `host/session-status(running:true)` (a blank session never runs), and a
 * reconnecting client takes `session.list`'s summary.blank as authoritative.
 * agent-error is the only outlet for live failures with no turn position;
 * workspace-changed pushes the full new snapshot after every durable
 * workspace mutation (create/attach/order change — the client upserts, while
 * `workspace.list` provides the reconnect baseline); workspace-removed is the
 * committed registration-deletion increment and never implies directory or
 * session-log deletion; workspace-order-changed pushes the complete durable
 * registry order after a reorder; archived-sessions-changed pushes the full registry
 * archive set after every durable change (same full-snapshot posture as
 * workspace-changed — `workspace.list` re-baselines it on reconnect).
 */
export type HostFrame =
  | {
    type: 'host/session-added'
    sessionId: SessionId
    blank: boolean
    parentSessionId?: SessionId
    origin?: 'subagent'
    cwd?: string
    agentPreset?: string
  }
  | { type: 'host/session-removed'; sessionId: SessionId }
  | { type: 'host/session-status'; sessionId: SessionId; running: boolean }
  | { type: 'host/agent-error'; sessionId: SessionId; message: string }
  | { type: 'host/workspace-changed'; workspace: WorkspaceView }
  | { type: 'host/workspace-removed'; workspaceId: WorkspaceView['workspaceId'] }
  | { type: 'host/workspace-order-changed'; workspaceIds: WorkspaceView['workspaceId'][] }
  | { type: 'host/archived-sessions-changed'; archivedSessionIds: SessionId[] }
  /**
   * One allowlisted host cordis event forwarded verbatim. The allowlist is
   * owned by `@deepseek-ai/dsh-api-remotes` (`API_REMOTE_FORWARDED_EVENTS`),
   * which is also the only control point over what a consumer can receive.
   * `event` is the host's own event name and `args` its argument list: this
   * path applies no projection, no redaction, and no renaming, so the payload
   * contract is the owner package's cordis `Events` declaration rather than
   * anything stated here. Delivery lands on `ctx.remote.$on`, not on a
   * per-event frame variant.
   */
  | { type: 'host/remote-event'; event: string; args: JsonValue[] }
  | { type: 'stream/error'; error: RpcError }
