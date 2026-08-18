import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  GoalId,
  type GoalSnapshotChangeMeta,
} from '@deepseek-ai/dsh-goal'
import * as GoalInvariantCompanion from '@deepseek-ai/dsh-goal/invariant'
import InvariantRegistry, { InvariantError } from '@deepseek-ai/dsh-invariants'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'

const change: GoalSnapshotChangeMeta = {
  kind: 'goal/change',
  version: 1,
  operation: 'create',
  goal: {
    id: GoalId('goal-invariant'),
    revision: 1,
    objective: 'check the stream',
    phase: 'active',
    maxGoalRounds: 2,
  },
  roundsStarted: 0,
  createdAt: 1,
  updatedAt: 1,
}

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(GoalInvariantCompanion)
  return ctx
}

describe('goal stream invariants', () => {
  it('accepts canonical goal snapshots and sequential admitted rounds', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('goal-invariant-valid'))
    session.append('goal/change', change)
    session.append('turn/start', { turn: 1 })
    expect(() => {
      session.append('user/message', createUserMessage({
        content: [{ type: 'text', text: 'continue' }],
        source: { kind: 'goal', goalId: change.goal.id, revision: 1, round: 1 },
      }), { surfaceOp: 'append' })
    }).not.toThrow()
  })

  it('rejects a malformed goal change before committing it and keeps the fold reusable', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('goal-invariant-invalid'))
    expect(() => {
      session.append('goal/change', { ...change, extra: true } as never)
    }).toThrow(expect.objectContaining<Partial<InvariantError>>({
      code: 'INVARIANT',
      packageName: '@deepseek-ai/dsh-goal',
    }))
    expect(session.seq).toBe(0)
    expect(() => {
      session.append('goal/change', change)
    }).not.toThrow()
  })

  it('reconstructs an existing durable goal before checking later rounds', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('goal-invariant-late-load'))
    session.append('goal/change', change)

    await ctx.plugin(InvariantRegistry, { enabled: true })
    await ctx.plugin(GoalInvariantCompanion)
    session.append('turn/start', { turn: 1 })
    expect(() => {
      session.append('user/message', createUserMessage({
        content: [{ type: 'text', text: 'continue after load' }],
        source: { kind: 'goal', goalId: change.goal.id, revision: 1, round: 1 },
      }), { surfaceOp: 'append' })
    }).not.toThrow()
  })
})
