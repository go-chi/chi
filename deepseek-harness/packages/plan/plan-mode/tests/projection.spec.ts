/**
 * The `plan` projection unit (session-projection RFC's complete example): a
 * double-event fold over the session log. `command/run` records named `plan`
 * with recorded input set the wanted target (`off` → false, anything else
 * → true); `plan/mode` commits and clears it. `view` reports pending only
 * while an outstanding selection differs from the logged state.
 * Pending is thereby a pure replay quantity — a cold fold answers it without
 * the service's in-memory intent. Composition without plan-mode has no `plan`
 * key; unloading the fiber removes it (HMR safety).
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { CommandId } from '@deepseek-ai/dsh-commands/brand'
import PlanModeController from '@deepseek-ai/dsh-plan-mode'

interface Bench {
  ctx: Context
  session: Session
  values(): Record<string, unknown>
}

async function harness(withPlanMode: boolean): Promise<Bench> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionProjectionRegistry)
  if (withPlanMode) await ctx.plugin(PlanModeController, { section: 'plan policy' })
  const session = ctx.sessions.create()
  ctx.agents.register({ id: session.id, session, status: 'idle', ctx } as Agent)
  return {
    ctx,
    session,
    values: () => ctx.sessionProjections.snapshot(session).values,
  }
}

/** Append one logged /plan selection record (the executor's command/run shape). */
function runPlanCommand(session: Session, args: string, index: number): void {
  session.append('command/run', {
    commandId: CommandId(`plan-proj-${String(index)}`),
    name: 'plan',
    args,
    source: { kind: 'user' },
  })
}

/** Commit one plan/mode flip inside an open turn (the invariant's turn-enclosure rule). */
function commitPlanMode(session: Session, active: boolean, turn: number): void {
  session.append('turn/start', { turn })
  session.append('plan/mode', { active })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

describe('plan projection unit', () => {
  it('serves inactive/not-pending for the empty log', async () => {
    const bench = await harness(true)
    expect(bench.values()).toEqual({ plan: { active: false, pending: false } })
  })

  it('a logged /plan selection reads pending until plan/mode records it', async () => {
    const bench = await harness(true)
    runPlanCommand(bench.session, '', 0)
    expect(bench.values().plan).toEqual({ active: false, pending: true })
    // A repeated identical selection returns the same state reference (no frame).
    runPlanCommand(bench.session, '', 1)
    expect(bench.values().plan).toEqual({ active: false, pending: true })
    commitPlanMode(bench.session, true, 0)
    expect(bench.values().plan).toEqual({ active: true, pending: false })
  })

  it('folds `off` args and non-plan commands correctly, and a matching selection is not pending', async () => {
    const bench = await harness(true)
    commitPlanMode(bench.session, true, 0)
    // Another command's record never touches plan state.
    bench.session.append('command/run', {
      commandId: CommandId('other-1'), name: 'compact', args: '', source: { kind: 'user' },
    })
    expect(bench.values().plan).toEqual({ active: true, pending: false })
    // A command lifecycle with omitted input carries no plan selection.
    bench.session.append('command/run', {
      commandId: CommandId('plan-no-input'), name: 'plan', source: { kind: 'user' },
    })
    expect(bench.values().plan).toEqual({ active: true, pending: false })
    runPlanCommand(bench.session, ' off', 1)
    expect(bench.values().plan).toEqual({ active: true, pending: true })
    commitPlanMode(bench.session, false, 1)
    expect(bench.values().plan).toEqual({ active: false, pending: false })
    // Selecting the already-committed state folds to not-pending (net zero).
    runPlanCommand(bench.session, 'off', 2)
    expect(bench.values().plan).toEqual({ active: false, pending: false })
  })

  it('a /plan message-argument selection targets plan mode', async () => {
    const bench = await harness(true)
    runPlanCommand(bench.session, ' sketch the refactor first', 0)
    expect(bench.values().plan).toEqual({ active: false, pending: true })
  })

  it('has no plan key when plan-mode is not composed', async () => {
    const bench = await harness(false)
    expect('plan' in bench.values()).toBe(false)
  })

  it('drops the key when the plan-mode fiber unloads (HMR safety)', async () => {
    const bench = await harness(false)
    const fiber = await bench.ctx.plugin(PlanModeController, { section: 'plan policy' })
    expect(bench.values().plan).toEqual({ active: false, pending: false })
    await fiber.dispose()
    expect('plan' in bench.values()).toBe(false)
  })

  it('cold replay recovers pending from the log alone (a fresh registry refolds it)', async () => {
    const bench = await harness(true)
    runPlanCommand(bench.session, '', 0)
    // A second registry over the same log (the cold-read shape): no service
    // memory involved, the fold alone answers {active:false, pending:true}.
    const cold = await harness(true)
    for (const event of bench.session.events) {
      if (event.type === 'command/run' || event.type === 'plan/mode') {
        cold.session.append(event.type, event.data)
      }
    }
    expect(cold.values().plan).toEqual({ active: false, pending: true })
  })
})
