import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry, { InvariantError } from '@deepseek-ai/dsh-invariants'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import { WorkflowRunId, type WorkflowRunId as WorkflowRunIdType } from '@deepseek-ai/dsh-workflow/types'
import * as ToolWorkflowInvariant from '../src/invariant.ts'
import type {} from '../src/types.ts'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(ToolWorkflowInvariant)
  return ctx
}

describe('durable workflow-record invariants', () => {
  it('accepts interleaved complete runs and an unfinished continuous prefix', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('workflow-record-valid'))
    session.append('turn/start', { turn: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const first = WorkflowRunId('first')
    const second = WorkflowRunId('second')
    const third = WorkflowRunId('third')
    session.append('tool-workflow/run-start', { runId: first, name: 'first' })
    session.append('tool-workflow/run-start', { runId: second, name: 'second' })
    session.append('tool-workflow/agent-start', {
      runId: second, seq: 1, label: '', phase: '', childId: SessionId('child'),
    })
    session.append('tool-workflow/run-end', { runId: first, stopReason: 'completed' })
    session.append('tool-workflow/agent-end', { runId: second, seq: 1, outcome: 'cancelled' })
    session.append('tool-workflow/run-end', { runId: second, stopReason: 'cancelled' })
    session.append('tool-workflow/run-start', { runId: third, name: 'third' })
    session.append('tool-workflow/agent-start', {
      runId: third, seq: 1, label: 'failed', childId: SessionId('failed-child'),
    })
    session.append('tool-workflow/agent-end', { runId: third, seq: 1, outcome: 'failed' })
    session.append('tool-workflow/run-end', { runId: third, stopReason: 'error' })
    session.append('tool-workflow/run-start', { runId: WorkflowRunId('prefix'), name: 'prefix' })
    expect(() => session.append('tool-workflow/agent-start', {
      runId: WorkflowRunId('prefix'), seq: 1, label: 'open', childId: SessionId('open-child'),
    })).not.toThrow()
  })

  it('rejects a malformed candidate before commit and keeps the fold reusable', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('workflow-record-invalid'))
    const runId = WorkflowRunId('run')
    session.append('tool-workflow/run-start', { runId, name: 'run' })
    const before = session.seq
    expect(() => session.append('tool-workflow/agent-end', {
      runId, seq: 1, outcome: 'completed',
    })).toThrow(expect.objectContaining<Partial<InvariantError>>({
      code: 'INVARIANT',
      packageName: '@deepseek-ai/dsh-tool-workflow',
    }))
    expect(session.seq).toBe(before)
    expect(() => session.append('tool-workflow/run-end', {
      runId, stopReason: 'completed',
    })).not.toThrow()
  })

  type Mutation = (session: Session, runId: WorkflowRunIdType) => void
  const appendRaw = (session: Session, type: string, data: unknown): void => {
    const append = session.append.bind(session) as (eventType: string, eventData: unknown) => unknown
    append(type, data)
  }
  const invalidCases: readonly [string, Mutation, RegExp][] = [
    ['null event data', (session) => {
      appendRaw(session, 'tool-workflow/run-start', null)
    }, /data must be a JSON object/],
    ['primitive event data', (session) => {
      appendRaw(session, 'tool-workflow/run-start', 1)
    }, /data must be a JSON object/],
    ['array event data', (session) => {
      appendRaw(session, 'tool-workflow/run-start', [])
    }, /data must be a JSON object/],
    ['numeric run id', (session) => {
      session.append('tool-workflow/agent-start', {
        runId: 1 as never, seq: 1, label: 'bad', childId: SessionId('child'),
      })
    }, /runId must be a non-empty string/],
    ['empty run id', (session) => {
      session.append('tool-workflow/agent-start', {
        runId: WorkflowRunId(''), seq: 1, label: 'bad', childId: SessionId('child'),
      })
    }, /runId must be a non-empty string/],
    ['empty run name', (session) => {
      session.append('tool-workflow/run-start', { runId: WorkflowRunId('empty-name'), name: '' })
    }, /name must be a non-empty string/],
    ['non-string run name', (session) => {
      session.append('tool-workflow/run-start', { runId: WorkflowRunId('bad-name'), name: 1 as never })
    }, /name must be a non-empty string/],
    ['duplicate run', (session, runId) => {
      session.append('tool-workflow/run-start', { runId, name: 'again' })
    }, /repeats run/],
    ['missing run', (session) => {
      session.append('tool-workflow/agent-start', {
        runId: WorkflowRunId('missing'), seq: 1, label: 'bad', childId: SessionId('child'),
      })
    }, /no matching tool-workflow\/run-start/],
    ['non-positive member seq', (session, runId) => {
      session.append('tool-workflow/agent-start', {
        runId, seq: 0, label: 'bad', childId: SessionId('child'),
      })
    }, /positive safe integer/],
    ['non-integer member seq', (session, runId) => {
      session.append('tool-workflow/agent-start', {
        runId, seq: 1.5, label: 'bad', childId: SessionId('child'),
      })
    }, /positive safe integer/],
    ['non-string member label', (session, runId) => {
      session.append('tool-workflow/agent-start', {
        runId, seq: 1, label: 1 as never, childId: SessionId('child'),
      })
    }, /label must be a string/],
    ['non-string member phase', (session, runId) => {
      session.append('tool-workflow/agent-start', {
        runId, seq: 1, label: 'bad', phase: 1 as never, childId: SessionId('child'),
      })
    }, /phase must be a string/],
    ['empty child id', (session, runId) => {
      session.append('tool-workflow/agent-start', {
        runId, seq: 1, label: 'bad', childId: SessionId(''),
      })
    }, /childId must be a non-empty string/],
    ['duplicate member start', (session, runId) => {
      session.append('tool-workflow/agent-start', {
        runId, seq: 1, label: 'one', childId: SessionId('child'),
      })
      session.append('tool-workflow/agent-start', {
        runId, seq: 1, label: 'two', childId: SessionId('child-2'),
      })
    }, /repeats member seq/],
    ['invalid member outcome', (session, runId) => {
      session.append('tool-workflow/agent-start', {
        runId, seq: 1, label: 'one', childId: SessionId('child'),
      })
      session.append('tool-workflow/agent-end', { runId, seq: 1, outcome: 'unknown' as never })
    }, /outcome unknown is invalid/],
    ['duplicate member end', (session, runId) => {
      session.append('tool-workflow/agent-start', {
        runId, seq: 1, label: 'one', childId: SessionId('child'),
      })
      session.append('tool-workflow/agent-end', { runId, seq: 1, outcome: 'completed' })
      session.append('tool-workflow/agent-end', { runId, seq: 1, outcome: 'completed' })
    }, /repeats member seq/],
    ['run end with an open member', (session, runId) => {
      session.append('tool-workflow/agent-start', {
        runId, seq: 1, label: 'open', childId: SessionId('child'),
      })
      session.append('tool-workflow/run-end', { runId, stopReason: 'completed' })
    }, /leaves member seq 1 open/],
    ['invalid run stop reason', (session, runId) => {
      session.append('tool-workflow/run-end', { runId, stopReason: 'unknown' as never })
    }, /stopReason unknown is invalid/],
    ['event after run end', (session, runId) => {
      session.append('tool-workflow/run-end', { runId, stopReason: 'completed' })
      session.append('tool-workflow/agent-start', {
        runId, seq: 1, label: 'late', childId: SessionId('child'),
      })
    }, /appears after/],
    ['unknown workflow event', (session, runId) => {
      appendRaw(session, 'tool-workflow/unknown', { runId })
    }, /unknown tool-workflow event type/],
  ]

  it.each(invalidCases)('rejects %s', async (_name, mutate, pattern) => {
    const ctx = await setup()
    const session = ctx.sessions.create()
    const runId = WorkflowRunId('run')
    session.append('tool-workflow/run-start', { runId, name: 'run' })
    expect(() => { mutate(session, runId) }).toThrow(pattern)
  })

  it('validates existing cold history while allowing an unfinished prefix', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const valid = ctx.sessions.create(SessionId('workflow-record-cold-valid'))
    valid.append('tool-workflow/run-start', { runId: WorkflowRunId('valid'), name: 'valid' })
    valid.append('tool-workflow/agent-start', {
      runId: WorkflowRunId('valid'), seq: 1, label: 'open', childId: SessionId('child'),
    })
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(ToolWorkflowInvariant)).resolves.toBeDefined()

    const brokenCtx = new Context()
    await brokenCtx.plugin(SessionStore)
    const broken = brokenCtx.sessions.create(SessionId('workflow-record-cold-invalid'))
    broken.append('tool-workflow/run-start', { runId: WorkflowRunId('broken'), name: 'broken' })
    broken.append('tool-workflow/run-end', { runId: WorkflowRunId('broken'), stopReason: 'completed' })
    broken.append('tool-workflow/agent-start', {
      runId: WorkflowRunId('broken'), seq: 1, label: 'late', childId: SessionId('late'),
    })
    await brokenCtx.plugin(InvariantRegistry, { enabled: true })
    await expect(brokenCtx.plugin(ToolWorkflowInvariant)).rejects.toThrow(/appears after/)
  })
})
