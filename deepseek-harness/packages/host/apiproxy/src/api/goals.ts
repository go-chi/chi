/**
 * goals domain contract. Method signatures are the source of truth:
 * unary methods take the RpcRequest<P> narrow form and the impl echoes rpcId.
 *
 * Mutations only: the read side is the 'goal' session projection (history
 * tail-page projections block + session/projection frames), so there is no
 * goal.get and no wire goal view — responses acknowledge with the new CAS
 * ref and never feed client state (the committed goal/change event reaches
 * every client through the mux stream carrying the same whole value).
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Identifies one goal across its durable revisions. */
export type GoalId = Branded<'GoalId'>

/** Compare-and-set identity for one exact goal revision. */
export interface GoalRef {
  readonly id: GoalId
  readonly revision: number
}

/**
 * Goal-domain unary methods. Every mutation resolves an ordinary session's
 * Agent and applies one CAS-guarded verb; session-backed subagents reject with
 * `agent-busy`.
 */
export interface GoalsApi {
  /** Create and arm a goal. */
  create(request: RpcRequest<{ sessionId: SessionId; objective: string; maxGoalRounds?: number }>):
  Promise<RpcResponse<{ ref: GoalRef }>>

  /** Edit objective and/or round cap without changing phase. */
  edit(request: RpcRequest<{ sessionId: SessionId; ref: GoalRef; objective?: string; maxGoalRounds?: number }>):
  Promise<RpcResponse<{ ref: GoalRef }>>

  /** Pause an active goal and disarm automatic continuation. */
  pause(request: RpcRequest<{ sessionId: SessionId; ref: GoalRef }>):
  Promise<RpcResponse<{ ref: GoalRef }>>

  /** Resume and arm a stopped goal. */
  resume(request: RpcRequest<{ sessionId: SessionId; ref: GoalRef }>):
  Promise<RpcResponse<{ ref: GoalRef }>>

  /** Mark a current non-complete goal complete and disarm it. */
  complete(request: RpcRequest<{ sessionId: SessionId; ref: GoalRef }>):
  Promise<RpcResponse<{ ref: GoalRef }>>

  /** Clear the current goal while retaining a durable tombstone and history. */
  clear(request: RpcRequest<{ sessionId: SessionId; ref: GoalRef }>):
  Promise<RpcResponse<{ cleared: true }>>
}
