import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  GoalId,
  type GoalSnapshotChangeMeta,
  type GoalView,
} from '@deepseek-ai/dsh-goal'
import * as GoalSessionInvariant from '@deepseek-ai/dsh-goal-round-driver/invariant'
import { renderGoalRoundPrompt } from '@deepseek-ai/dsh-goal-round-driver'
import InvariantRegistry, { InvariantError } from '@deepseek-ai/dsh-invariants'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'

const change: GoalSnapshotChangeMeta = {
  kind: 'goal/change',
  version: 1,
  operation: 'create',
  goal: {
    id: GoalId('goal-round-driver-invariant'),
    revision: 1,
    objective: 'verify every continuation prompt',
    phase: 'active',
    maxGoalRounds: 2,
  },
  roundsStarted: 0,
  createdAt: 1,
  updatedAt: 1,
}

function view(roundsStarted: number): GoalView {
  return { ...change.goal, roundsStarted, createdAt: 1, updatedAt: 1, activation: 'armed' }
}

function appendChange(session: Session): void {
  session.append('goal/change', change)
}

function appendRound(session: Session, turn: number, content = renderGoalRoundPrompt(view(turn - 2), turn - 1)): void {
  const source = { kind: 'goal', goalId: change.goal.id, revision: 1, round: turn - 1 } as const
  session.append('turn/start', { turn })
  session.append('user/message', createUserMessage({
    content, source,
  }), { surfaceOp: 'append' })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

async function mount(sessionFirst = false): Promise<{ ctx: Context; session: Session }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const session = ctx.sessions.create(SessionId('goal-round-driver-invariant'))
  if (!sessionFirst) {
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await ctx.plugin(GoalSessionInvariant)
  }
  return { ctx, session }
}

describe('goal-round-driver prompt invariants', () => {
  it('reconstructs existing rounds and accepts the next canonical prompt', async () => {
    const { ctx, session } = await mount(true)
    appendChange(session)
    appendRound(session, 2)

    await ctx.plugin(InvariantRegistry, { enabled: true })
    await ctx.plugin(GoalSessionInvariant)

    expect(() => { appendRound(session, 3) }).not.toThrow()
    ctx.sessions.create(SessionId('goal-session-invariant-dispatch'))

    const userSource = { kind: 'user' } as const
    session.append('turn/start', { turn: 4 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'ordinary human message' }],
      source: userSource,
    }), { surfaceOp: 'append' })
    session.append('turn/end', { turn: 4, reason: { kind: 'completed' } })

    const stateSource = {
      kind: 'goal', goalId: change.goal.id, revision: change.goal.revision, round: 0,
    } as never
    session.append('turn/start', { turn: 5 })
    expect(() => {
      session.append('user/message', createUserMessage({
        content: [{ type: 'text', text: 'round zero is not a driver continuation' }],
        source: stateSource,
      }), { surfaceOp: 'append' })
    }).not.toThrow()
  })

  it('rejects a continuation whose content differs from the package renderer', async () => {
    const { session } = await mount()
    appendChange(session)

    expect(() => {
      appendRound(session, 2, [{ type: 'text', text: 'counterfeit continuation' }])
    }).toThrow(expect.objectContaining<Partial<InvariantError>>({
      code: 'INVARIANT',
      packageName: '@deepseek-ai/dsh-goal-round-driver',
    }))
  })

  it('rejects a goal round without a reconstructable active goal', async () => {
    const { session } = await mount()
    const source = { kind: 'goal', goalId: change.goal.id, revision: 1, round: 1 } as const
    session.append('turn/start', { turn: 1 })

    expect(() => {
      session.append('user/message', createUserMessage({
        content: renderGoalRoundPrompt(view(0), 1),
        source,
      }), { surfaceOp: 'append' })
    }).toThrow(expect.objectContaining<Partial<InvariantError>>({
      packageName: '@deepseek-ai/dsh-goal-round-driver',
    }))
  })

  it('attributes an invalid durable prefix during late loading', async () => {
    const { ctx, session } = await mount(true)
    session.append('goal/change', { ...change, extra: true } as never)
    appendRound(session, 2)
    await ctx.plugin(InvariantRegistry, { enabled: true })

    await expect(ctx.plugin(GoalSessionInvariant)).rejects.toMatchObject({
      code: 'INVARIANT',
      packageName: '@deepseek-ai/dsh-goal-round-driver',
    })
  })
})
