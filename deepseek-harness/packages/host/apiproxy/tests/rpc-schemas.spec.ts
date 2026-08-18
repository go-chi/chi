import { describe, expect, it } from 'vitest'
import { RpcId, transportError } from '../src/api/rpc.ts'
import {
  clientRequestSchema, clientResponseSchema, rpcErrorSchema, rpcIdSchema, rpcMessageSchema,
  rpcReceiptSchema, rpcResultSchema, serverRequestSchema, serverResponseSchema,
} from '../src/api/rpc.schema.ts'
import { z } from 'zod'
import {
  contentBlockSchema, sessionCancelRequestSchema, sessionCancelValueSchema, sessionCreateRequestSchema,
  sessionCreateValueSchema, sessionEventSchema, sessionHistoryRequestSchema, sessionHistoryValueSchema,
  sessionIdSchema, sessionListRequestSchema, sessionListValueSchema, sessionModelsRequestSchema,
  sessionModelsValueSchema, sessionPromptRequestSchema, sessionPromptValueSchema,
  sessionSearchRequestSchema, sessionSearchValueSchema, sessionSelectModelRequestSchema,
  sessionSelectModelValueSchema, sessionSummarySchema,
  sessionUpdateQueueRequestSchema, sessionUpdateQueueValueSchema,
} from '../src/api/sessions.schema.ts'
import {
  hostCreateDirectoryRequestSchema, hostCreateDirectoryValueSchema,
  hostDescribeRequestSchema, hostDescribeValueSchema,
  hostListDirectoryRequestSchema, hostListDirectoryValueSchema,
} from '../src/api/host.schema.ts'
import {
  workspaceArchiveSessionRequestSchema, workspaceArchiveSessionValueSchema,
  workspaceCreateRequestSchema, workspaceCreateValueSchema, workspaceIdSchema,
  workspaceDeleteRequestSchema, workspaceDeleteValueSchema,
  workspaceInsertBeforeRequestSchema, workspaceInsertBeforeValueSchema,
  workspaceInsertSessionBeforeRequestSchema, workspaceInsertSessionBeforeValueSchema,
  workspaceListRequestSchema, workspaceListValueSchema,
  workspaceRenameRequestSchema, workspaceRenameValueSchema, workspaceViewSchema,
} from '../src/api/workspace.schema.ts'
import { skillEntrySchema, skillListRequestSchema, skillListValueSchema } from '../src/api/skills.schema.ts'
import {
  agentPresetEntrySchema, agentPresetListValueSchema, agentPresetOpenDocumentValueSchema,
} from '../src/api/agent-presets.schema.ts'
import { hostFrameSchema, muxFrameSchema, askUserQuestionItemSchema } from '../src/api/events.schema.ts'
import { approvalRequestIdSchema, approvalResponsePayloadSchema } from '../src/api/approvals.schema.ts'
import { askUserQuestionAnswerSchema, questionResponsePayloadSchema } from '../src/api/questions.schema.ts'
import { goalEditRequestSchema } from '../src/api/goals.schema.ts'
import { subagentPromptRequestSchema } from '../src/api/subagents.schema.ts'

describe('RpcId', () => {
  it('brands a raw string at zero runtime cost', () => {
    expect(RpcId('abc')).toBe('abc')
    expect(rpcIdSchema.parse('abc')).toBe('abc')
    // No min-length: the id is an opaque echo token (see rpcIdSchema's contract).
    expect(rpcIdSchema.parse('')).toBe('')
    expect(() => rpcIdSchema.parse(42)).toThrow()
  })
})

describe('transportError', () => {
  it('folds Error and non-Error throws into the internal error branch', () => {
    expect(transportError(new Error('wire down'))).toEqual({ ok: false, error: { code: 'internal', message: 'wire down', details: {} } })
    expect(transportError('raw')).toMatchObject({ ok: false, error: { code: 'internal', message: 'raw' } })
  })
})

describe('rpcErrorSchema', () => {
  it('accepts every code branch with its required details', () => {
    expect(rpcErrorSchema.parse({ code: 'bad-request', message: 'm', details: { issues: [] } }).code).toBe('bad-request')
    expect(rpcErrorSchema.parse({ code: 'cancelled', message: 'm', details: {} }).code).toBe('cancelled')
    expect(rpcErrorSchema.parse({ code: 'session-not-found', message: 'm', details: { sessionId: 's' } }).code).toBe('session-not-found')
    expect(rpcErrorSchema.parse({ code: 'session-conflict', message: 'm', details: { sessionId: 's', requestedCwd: '/a', existingCwd: '/b' } }).code).toBe('session-conflict')
    expect(rpcErrorSchema.parse({ code: 'invalid-time-zone', message: 'm', details: { value: 'CST' } }).code).toBe('invalid-time-zone')
    expect(rpcErrorSchema.parse({ code: 'workspace-attach-failed', message: 'm', details: { sessionId: 's', workspaceId: 'w' } }).code).toBe('workspace-attach-failed')
    expect(rpcErrorSchema.parse({ code: 'workspace-not-found', message: 'm', details: { workspaceId: 'w' } }).code).toBe('workspace-not-found')
    expect(rpcErrorSchema.parse({ code: 'workspace-invalid-path', message: 'm', details: { path: '/x' } }).code).toBe('workspace-invalid-path')
    expect(rpcErrorSchema.parse({ code: 'workspace-name-conflict', message: 'm', details: { name: 'x' } }).code).toBe('workspace-name-conflict')
    expect(rpcErrorSchema.parse({ code: 'workspace-move-invalid', message: 'm', details: { workspaceId: 'w', sessionId: 's' } }).code).toBe('workspace-move-invalid')
    expect(rpcErrorSchema.parse({
      code: 'model-unavailable',
      message: 'm',
      details: { provider: 'p', model: 'm' },
    }).code).toBe('model-unavailable')
    expect(rpcErrorSchema.parse({ code: 'agent-busy', message: 'm', details: { reason: 'r' } }).code).toBe('agent-busy')
    expect(rpcErrorSchema.parse({ code: 'queue-item-not-found', message: 'm', details: { itemId: 'i' } }).code).toBe('queue-item-not-found')
    expect(rpcErrorSchema.parse({ code: 'command-error', message: 'm', details: {} }).code).toBe('command-error')
    expect(rpcErrorSchema.parse({ code: 'unknown-command', message: 'm', details: {} }).code).toBe('unknown-command')
    expect(rpcErrorSchema.parse({ code: 'title-invalid', message: 'm', details: { sessionId: 's' } }).code).toBe('title-invalid')
    // The credentials producer still emits this code, so the branch has to stay.
    expect(rpcErrorSchema.parse({ code: 'credential-rejected', message: 'm', details: { ref: 'r' } }).code).toBe('credential-rejected')
    expect(rpcErrorSchema.parse({ code: 'internal', message: 'm', details: {} }).code).toBe('internal')
  })

  it('rejects a known code with missing details', () => {
    expect(() => rpcErrorSchema.parse({ code: 'agent-busy', message: 'm', details: {} })).toThrow()
    expect(() => rpcErrorSchema.parse({ code: 'title-invalid', message: 'm', details: {} })).toThrow()
    expect(() => rpcErrorSchema.parse({ code: 'command-error', message: 'm' })).toThrow()
    expect(() => rpcErrorSchema.parse({ code: 'nope', message: 'm', details: {} })).toThrow()
  })
})

describe('rpcResultSchema', () => {
  it('accepts both result branches and rejects hybrids', () => {
    const schema = rpcResultSchema(z.object({ n: z.number() }))
    expect(schema.parse({ ok: true, value: { n: 1 } })).toEqual({ ok: true, value: { n: 1 } })
    const err = schema.parse({ ok: false, error: { code: 'internal', message: 'x', details: {} } })
    expect(err).toMatchObject({ ok: false })
    expect(() => schema.parse({ ok: true, error: {} })).toThrow()
  })
})

describe('wire full-form schemas', () => {
  it('parses the four quadrants and the union discriminates on type', () => {
    const cq = { type: 'client-request', rpcId: 'r1', method: 'session.list', payload: {} }
    const sr = { type: 'server-response', rpcId: 'r1', result: { ok: true, value: 1 } }
    const rq = { type: 'server-request', rpcId: 'r2', method: 'session/event', payload: { a: 1 } }
    const cr = { type: 'client-response', rpcId: 'r2', result: { ok: true, value: null } }
    expect(clientRequestSchema.parse(cq).method).toBe('session.list')
    expect(serverResponseSchema.parse(sr).rpcId).toBe('r1')
    expect(serverRequestSchema.parse(rq).method).toBe('session/event')
    expect(clientResponseSchema.parse(cr).rpcId).toBe('r2')
    for (const message of [cq, sr, rq, cr]) expect(rpcMessageSchema.parse(message)).toBeTruthy()
    expect(() => rpcMessageSchema.parse({ type: 'other', rpcId: 'x' })).toThrow()
  })

  it('rejects a quadrant missing its members but accepts a valueless success result', () => {
    expect(() => clientRequestSchema.parse({ type: 'client-request', rpcId: 'r1' })).toThrow()
    expect(() => serverResponseSchema.parse({ type: 'server-response', rpcId: 'r1' })).toThrow()
    expect(() => serverResponseSchema.parse({ type: 'server-response', rpcId: 'r1', result: {} })).toThrow()
    // A void business result carries no value field; the endpoint's own second
    // parse is what requires a value for methods that return data.
    expect(serverResponseSchema.parse({ type: 'server-response', rpcId: 'r1', result: { ok: true } }).rpcId)
      .toBe('r1')
  })
})

describe('rpcReceiptSchema', () => {
  it('accepts both receipt branches with the closed reason set', () => {
    expect(rpcReceiptSchema.parse({ accepted: true })).toEqual({ accepted: true })
    expect(rpcReceiptSchema.parse({ accepted: false, reason: 'not-pending' })).toEqual({ accepted: false, reason: 'not-pending' })
    expect(rpcReceiptSchema.parse({ accepted: false, reason: 'bad-response' })).toEqual({ accepted: false, reason: 'bad-response' })
    expect(() => rpcReceiptSchema.parse({ accepted: false, reason: 'other' })).toThrow()
  })
})

describe('sessions domain schemas', () => {
  it('validates ids, summaries, and the event passthrough envelope', () => {
    expect(sessionIdSchema.parse('s1')).toBe('s1')
    expect(() => sessionIdSchema.parse('')).toThrow()
    expect(sessionSummarySchema.parse({ sessionId: 's1', updatedAt: 1, running: false, blank: true })).toMatchObject({ sessionId: 's1', blank: true })
    expect(sessionSummarySchema.parse({ sessionId: 's1', updatedAt: 1, running: true, blank: false, parentSessionId: 'p', cwd: '/x' }).cwd).toBe('/x')
    // blank is mandatory: a summary without it fails the parse.
    expect(() => sessionSummarySchema.parse({ sessionId: 's1', updatedAt: 1, running: false })).toThrow()
    const event = sessionEventSchema.parse({
      type: 'user/message',
      seq: 0,
      time: 1,
      data: { any: true },
    })
    expect(event).toMatchObject({ type: 'user/message' })
    expect(() => sessionEventSchema.parse({
      type: 'user/message',
      seq: -1,
      time: 1,
      data: {},
    })).toThrow()
  })

  it('validates the per-method request/value pairs', () => {
    expect(sessionListRequestSchema.parse({})).toEqual({})
    expect(sessionListRequestSchema.parse({ cursor: 'c' }).cursor).toBe('c')
    expect(sessionListValueSchema.parse({ items: [] }).items).toEqual([])
    expect(sessionSearchRequestSchema.parse({ query: '  exact phrase  ' })).toEqual({ query: 'exact phrase' })
    expect(() => sessionSearchRequestSchema.parse({ query: '   ' })).toThrow()
    expect(() => sessionSearchRequestSchema.parse({ query: 'bad\0query' })).toThrow(/NUL/)
    expect(() => sessionSearchRequestSchema.parse({ query: 'x'.repeat(501) })).toThrow()
    expect(sessionSearchValueSchema.parse({
      items: [{ sessionId: 's1', snippet: 'matching text' }],
      hasMore: true,
    })).toEqual({
      items: [{ sessionId: 's1', snippet: 'matching text' }],
      hasMore: true,
    })
    expect(sessionSearchValueSchema.parse({
      items: [{ sessionId: 's1', snippet: '😀'.repeat(240) }],
      hasMore: false,
    }).items[0]?.snippet).toBe('😀'.repeat(240))
    expect(() => sessionSearchValueSchema.parse({
      items: [{ sessionId: 's1', snippet: '😀'.repeat(241) }],
      hasMore: false,
    })).toThrow(/240 Unicode code points/)
    expect(() => sessionSearchValueSchema.parse({
      items: [{ sessionId: '', snippet: 'matching text' }],
      hasMore: false,
    })).toThrow()
    expect(() => sessionSearchValueSchema.parse({
      items: Array.from(
        { length: 21 },
        (_, index) => ({ sessionId: `s${index}`, snippet: 'matching text' }),
      ),
      hasMore: true,
    })).toThrow()
    expect(sessionCreateRequestSchema.parse({ cwd: '/w' }).cwd).toBe('/w')
    // The refine's both-sides branch: workspaceId alone passes, workspaceId+cwd rejects.
    expect(sessionCreateRequestSchema.parse({ workspaceId: 'w1', sessionId: 's1' }).sessionId).toBe('s1')
    expect(() => sessionCreateRequestSchema.parse({ workspaceId: 'w1', cwd: '/w' })).toThrow(/not both/)
    expect(sessionCreateValueSchema.parse({ sessionId: 's1' }).sessionId).toBe('s1')
    expect(sessionHistoryRequestSchema.parse({ sessionId: 's1', beforeSeq: 3, maxMessages: 5 }).beforeSeq).toBe(3)
    expect(() => sessionHistoryRequestSchema.parse({ sessionId: 's1', maxMessages: 0 })).toThrow()
    expect(sessionHistoryValueSchema.parse({
      events: [],
      hasMore: false,
      modelSelection: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    }).hasMore).toBe(false)
    expect(sessionModelsRequestSchema.parse({ sessionId: 's1' }).sessionId).toBe('s1')
    expect(sessionModelsValueSchema.parse({
      current: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'max' },
      routable: true,
      groups: [{
        id: 'deepseek-official',
        name: 'DeepSeek',
        models: [{
          id: 'deepseek-v4-flash',
          name: 'DeepSeek V4 Flash',
          description: 'fast',
          reasoning: {
            efforts: [
              { id: 'off', name: 'Off' },
              { id: 'max', name: 'Max', description: 'Largest budget' },
            ],
            defaultEffort: 'off',
          },
        }],
      }],
      failures: [{ id: 'broken', name: 'Broken', message: 'offline' }],
    }).groups[0]?.models[0]?.id).toBe('deepseek-v4-flash')
    expect(sessionSelectModelRequestSchema.parse({
      sessionId: 's1',
      provider: 'deepseek-official',
      model: 'deepseek-v4-pro',
      reasoningEffort: 'max',
    }).reasoningEffort).toBe('max')
    expect(sessionSelectModelValueSchema.parse({
      selected: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'max' },
    }).selected.reasoningEffort).toBe('max')
    expect(() => sessionSelectModelRequestSchema.parse({
      sessionId: 's1',
      provider: '',
      model: 'm',
    })).toThrow()
    expect(() => sessionSelectModelRequestSchema.parse({
      sessionId: 's1',
      provider: 'deepseek-official',
      model: 'm',
      reasoningEffort: '',
    })).toThrow()
    expect(() => sessionModelsValueSchema.parse({
      current: { provider: 'deepseek-official', model: 'm' },
      groups: [{
        id: 'deepseek-official',
        name: 'DeepSeek',
        models: [{ id: 'm', name: 'M', reasoning: { efforts: [] } }],
      }],
      failures: [],
    })).toThrow()
    const prompt = sessionPromptRequestSchema.parse({
      sessionId: 's1',
      mode: 'queue',
      content: [{ type: 'text', text: 'hi' }],
      clientTimeZone: 'Asia/Shanghai',
    })
    expect(prompt.mode).toBe('queue')
    expect(prompt.clientTimeZone).toBe('Asia/Shanghai')
    expect(sessionPromptRequestSchema.parse({
      sessionId: 's1', mode: 'queue', content: [],
    }).clientTimeZone).toBeUndefined()
    expect(() => sessionPromptRequestSchema.parse({ sessionId: 's1', mode: 'inject', content: [] })).toThrow()
    expect(sessionPromptValueSchema.parse({ accepted: true }).accepted).toBe(true)
    // The command slot appears only when the prompt dispatched a slash command.
    const dispatched = sessionPromptValueSchema.parse({ accepted: true, command: { kind: 'success', text: 'Goal set' } })
    expect(dispatched.command?.text).toBe('Goal set')
    expect(sessionPromptValueSchema.parse({ accepted: true, command: { kind: 'success' } }).command).toEqual({ kind: 'success' })
    expect(() => sessionPromptValueSchema.parse({ accepted: true, command: { kind: 'failure' } })).toThrow()
    expect(sessionCancelRequestSchema.parse({ sessionId: 's1' }).sessionId).toBe('s1')
    expect(sessionUpdateQueueRequestSchema.parse({
      sessionId: 's1',
      itemId: 'i1',
      action: { kind: 'edit', content: [{ type: 'text', text: 'next' }] },
    }).action.kind).toBe('edit')
    expect(sessionUpdateQueueRequestSchema.parse({
      sessionId: 's1', itemId: 'i1', action: { kind: 'remove' },
    }).action.kind).toBe('remove')
    expect(() => sessionUpdateQueueRequestSchema.parse({
      sessionId: 's1', itemId: 'i1', action: { kind: 'promote' },
    })).toThrow()
    expect(sessionCancelValueSchema.parse({ accepted: true }).accepted).toBe(true)
    expect(sessionUpdateQueueValueSchema.parse({ accepted: true }).accepted).toBe(true)
    expect(contentBlockSchema.parse({ type: 'text', text: 'x', extra: 1 })).toMatchObject({ extra: 1 })
  })
})

describe('subagent domain schemas', () => {
  it('carries optional request-local browser-zone provenance on prompts', () => {
    expect(subagentPromptRequestSchema.parse({
      parentSessionId: 'parent',
      childSessionId: 'child',
      mode: 'continuable',
      content: [{ type: 'text', text: 'continue' }],
      clientTimeZone: 'Asia/Shanghai',
    }).clientTimeZone).toBe('Asia/Shanghai')
    expect(subagentPromptRequestSchema.parse({
      parentSessionId: 'parent',
      childSessionId: 'child',
      mode: 'continuable',
      content: [],
    }).clientTimeZone).toBeUndefined()
  })
})

describe('host domain schemas', () => {
  it('validates describe request/value', () => {
    expect(hostDescribeRequestSchema.parse({})).toEqual({})
    const value = hostDescribeValueSchema.parse({
      version: '1', cwd: '/x', provider: 'p', model: 'm', attachedSessions: 2, canOpenPath: true,
    })
    expect(value).toMatchObject({ provider: 'p', model: 'm', attachedSessions: 2, canOpenPath: true })
    expect(hostDescribeValueSchema.parse({
      version: '1', cwd: '/x', attachedSessions: 0, canOpenPath: false,
    }).provider).toBeUndefined()
    expect(() => hostDescribeValueSchema.parse({
      version: '1', cwd: '/x', attachedSessions: 0,
    })).toThrow()
  })

  it('validates the browse listing/creation payloads', () => {
    expect(hostListDirectoryRequestSchema.parse({})).toEqual({})
    expect(hostListDirectoryRequestSchema.parse({ path: '/x' })).toEqual({ path: '/x' })
    const listing = hostListDirectoryValueSchema.parse({
      path: '/home/u/p',
      home: '/home/u',
      crumbs: [{ name: '/', path: '/', hidden: false }, { name: 'p', path: '/home/u/p', hidden: false }],
      entries: [{ name: '.dot', path: '/home/u/p/.dot', hidden: true }],
      truncated: false,
    })
    expect(listing.entries[0]?.hidden).toBe(true)
    // The flag is part of the wire value, not an optional decoration.
    expect(() => hostListDirectoryValueSchema.parse({ path: '/x', home: '/x', crumbs: [], entries: [] })).toThrow()
    expect(hostCreateDirectoryRequestSchema.parse({ path: '/x', name: 'new' })).toEqual({ path: '/x', name: 'new' })
    for (const name of ['', ' ', '.', '..', 'a/b', 'a\\b']) {
      expect(() => hostCreateDirectoryRequestSchema.parse({ path: '/x', name })).toThrow()
    }
    expect(hostCreateDirectoryValueSchema.parse({ path: '/x/new' })).toEqual({ path: '/x/new' })
  })
})

describe('workspace domain schemas', () => {
  const view = {
    workspaceId: 'w1', path: '/p', title: 'p', sessionIds: ['s1'],
    createdAt: '2026-07-25T00:00:00.000Z', updatedAt: '2026-07-25T00:00:00.000Z',
  }

  it('validates ids, the view row, and list request/value', () => {
    expect(workspaceIdSchema.parse('w1')).toBe('w1')
    expect(() => workspaceIdSchema.parse('')).toThrow()
    expect(workspaceViewSchema.parse(view).sessionIds).toEqual(['s1'])
    expect(() => workspaceViewSchema.parse({ ...view, sessionIds: 's1' })).toThrow()
    expect(workspaceListRequestSchema.parse({})).toEqual({})
    expect(workspaceListValueSchema.parse({ items: [view], archivedSessionIds: ['s1'] }).items).toHaveLength(1)
    expect(() => workspaceListValueSchema.parse({ items: [view] })).toThrow()
  })

  it('archiveSession request/value carry the id and the full updated set', () => {
    expect(workspaceArchiveSessionRequestSchema.parse({ sessionId: 's1' }).sessionId).toBe('s1')
    expect(() => workspaceArchiveSessionRequestSchema.parse({})).toThrow()
    expect(workspaceArchiveSessionValueSchema.parse({ archivedSessionIds: ['s1', 's2'] }).archivedSessionIds)
      .toEqual(['s1', 's2'])
    expect(() => workspaceArchiveSessionValueSchema.parse({ archivedSessionIds: 's1' })).toThrow()
  })

  it('insertSessionBefore accepts an anchored and an anchorless move', () => {
    expect(workspaceInsertSessionBeforeRequestSchema.parse({ workspaceId: 'w1', sessionId: 's1', beforeSessionId: 's2' }).beforeSessionId).toBe('s2')
    expect(workspaceInsertSessionBeforeRequestSchema.parse({ workspaceId: 'w1', sessionId: 's1' }).beforeSessionId).toBeUndefined()
    expect(() => workspaceInsertSessionBeforeRequestSchema.parse({ workspaceId: 'w1' })).toThrow()
    expect(workspaceInsertSessionBeforeValueSchema.parse({ workspace: view }).workspace.workspaceId).toBe('w1')
  })

  it('create requires a path', () => {
    expect(workspaceCreateRequestSchema.parse({ path: '/p' }).path).toBe('/p')
    expect(() => workspaceCreateRequestSchema.parse({})).toThrow()
    // The retired create-by-name spelling stays a clean schema rejection.
    expect(() => workspaceCreateRequestSchema.parse({ name: 'n' })).toThrow()
    expect(workspaceCreateValueSchema.parse({ workspace: view, created: false }).created).toBe(false)
  })

  it('rename requires a non-blank title (both refine arms)', () => {
    expect(workspaceRenameRequestSchema.parse({ workspaceId: 'w1', title: 'new' }).title).toBe('new')
    expect(() => workspaceRenameRequestSchema.parse({ workspaceId: 'w1', title: '  ' })).toThrow(/non-blank/)
    expect(workspaceRenameValueSchema.parse({ workspace: view }).workspace.workspaceId).toBe('w1')
  })

  it('validates workspace deletion payload and receipt', () => {
    expect(workspaceDeleteRequestSchema.parse({ workspaceId: 'w1' }).workspaceId).toBe('w1')
    expect(() => workspaceDeleteRequestSchema.parse({})).toThrow()
    expect(workspaceDeleteValueSchema.parse({ deleted: true })).toEqual({ deleted: true })
    expect(() => workspaceDeleteValueSchema.parse({ deleted: false })).toThrow()
  })

  it('insertBefore accepts an anchored or anchorless Workspace move and returns the complete order', () => {
    expect(workspaceInsertBeforeRequestSchema.parse({
      workspaceId: 'w1', beforeWorkspaceId: 'w2',
    }).beforeWorkspaceId).toBe('w2')
    expect(workspaceInsertBeforeRequestSchema.parse({ workspaceId: 'w1' }).beforeWorkspaceId)
      .toBeUndefined()
    expect(() => workspaceInsertBeforeRequestSchema.parse({ beforeWorkspaceId: 'w2' })).toThrow()
    expect(workspaceInsertBeforeValueSchema.parse({ workspaceIds: ['w2', 'w1'] }).workspaceIds)
      .toEqual(['w2', 'w1'])
  })
})

describe('skills domain schemas', () => {
  it('validates the list request/value pair', () => {
    expect(skillListRequestSchema.parse({ sessionId: 's1' })).toEqual({ sessionId: 's1' })
    // The wire is session-addressed only: a sessionId-less payload fails.
    expect(() => skillListRequestSchema.parse({})).toThrow()
    expect(skillListValueSchema.parse({ skills: [] }).skills).toEqual([])
    const value = skillListValueSchema.parse({ skills: [
      { name: 'commit-helper', description: 'Git commits', whenToUse: 'when committing', modelInvocable: true },
      { name: 'bare', description: 'No guidance', modelInvocable: false },
    ] })
    expect(value.skills[0]?.whenToUse).toBe('when committing')
    expect(value.skills[1]?.whenToUse).toBeUndefined()
    expect(value.skills[1]?.modelInvocable).toBe(false)
    expect(() => skillEntrySchema.parse({ name: '', description: 'd', modelInvocable: true })).toThrow()
    // modelInvocable is required wire data: an entry without it fails.
    expect(() => skillEntrySchema.parse({ name: 'n', description: 'd' })).toThrow()
  })
})

describe('goals domain schemas', () => {
  it('requires at least one replacement field for goal.edit', () => {
    const ref = { id: 'g1', revision: 1 }
    expect(goalEditRequestSchema.parse({ sessionId: 's1', ref, objective: 'updated' }).objective).toBe('updated')
    expect(goalEditRequestSchema.parse({ sessionId: 's1', ref, maxGoalRounds: 3 }).maxGoalRounds).toBe(3)
    expect(() => goalEditRequestSchema.parse({ sessionId: 's1', ref })).toThrow()
  })
})

describe('events frame schemas', () => {
  it('accepts every mux frame branch', () => {
    const frames = [
      { type: 'session/event', sessionId: 's', event: { type: 't', seq: 0, time: 1, data: null } },
      { type: 'session/subscribed', sessionId: 's', lastSeq: -1 },
      { type: 'approval/requested', sessionId: 's', approvalId: 'a', toolName: 'bash', callId: 'c', reason: 'r' },
      { type: 'approval/resolved', sessionId: 's', approvalId: 'a', outcome: 'allowed-once' },
      { type: 'question/requested', sessionId: 's', questions: [{ id: 'q', question: 'Q?', options: [{ label: 'L' }], multiSelect: true }] },
      { type: 'question/resolved', sessionId: 's', questionRpcId: 'r', outcome: 'answered' },
      { type: 'session/queue', sessionId: 's', items: [
        {
          id: 'm1',
          placement: 'queued',
          message: { id: 'm1', role: 'user', content: [{ type: 'text', text: 'queued prompt' }], source: { kind: 'user', rpcId: 'r9' } },
        },
      ] },
      { type: 'session/projection', sessionId: 's', key: 'todos', value: [{ content: 'x', status: 'pending' }], seq: 7 },
      { type: 'session/jobs', sessionId: 's', jobs: [] },
      { type: 'session/jobs', sessionId: 's', jobs: [
        { id: 'bash-1', kind: 'bash', label: 'pnpm run build', status: 'running', startedAt: 5 },
        { id: 'pty-send-2', kind: 'pty-send', label: 'send keys', status: 'failed', detail: 'exit code: 3', startedAt: 5, finishedAt: 9 },
      ] },
      { type: 'stream/error', error: { code: 'internal', message: 'm', details: {} } },
    ]
    for (const frame of frames) expect(muxFrameSchema.parse(frame)).toMatchObject({ type: frame.type })
    expect(() => muxFrameSchema.parse({ type: 'unknown/frame' })).toThrow()
    for (const invalid of [
      { type: 'session/projection', sessionId: 's', key: '', value: null, seq: 0 },
      { type: 'session/projection', sessionId: 's', key: 'todos', value: null, seq: -1 },
      { type: 'session/projection', sessionId: 's', key: 'todos', value: null, seq: 0.5 },
      // A producer kind stays an open string, but the closed status set and
      // the identity/label bounds are the carrier's own wire contract.
      { type: 'session/jobs', sessionId: 's', jobs: [{ id: '', kind: 'bash', label: 'l', status: 'running', startedAt: 0 }] },
      { type: 'session/jobs', sessionId: 's', jobs: [{ id: 'bash-1', kind: '', label: 'l', status: 'running', startedAt: 0 }] },
      { type: 'session/jobs', sessionId: 's', jobs: [{ id: 'bash-1', kind: 'bash', label: '', status: 'running', startedAt: 0 }] },
      { type: 'session/jobs', sessionId: 's', jobs: [{ id: 'bash-1', kind: 'bash', label: 'l', status: 'pending', startedAt: 0 }] },
      { type: 'session/jobs', sessionId: 's', jobs: [{ id: 'bash-1', kind: 'bash', label: 'l', status: 'running', startedAt: -1 }] },
      { type: 'session/jobs', sessionId: 's', jobs: [{ id: 'bash-1', kind: 'bash', label: 'l', status: 'completed', startedAt: 0, finishedAt: 0.5 }] },
    ]) expect(() => muxFrameSchema.parse(invalid)).toThrow()
    expect(askUserQuestionItemSchema.parse({ id: 'q', question: 'Q?' }).id).toBe('q')
  })

  it('rejects an empty question batch (ask() guarantees at least one, so an empty frame is host breakage)', () => {
    expect(() => muxFrameSchema.parse({ type: 'question/requested', sessionId: 's', questions: [] })).toThrow()
  })

  it('carries a question presentation intent through, and rejects an unknown one', () => {
    const intent = { kind: 'plan-review', approve: 'Approve' }
    expect(askUserQuestionItemSchema.parse({
      id: 'plan-review', question: 'Approve?', detail: '# Plan', options: [{ label: 'Approve' }], intent,
    }).intent).toEqual(intent)
    // An unrecognised tag is a rejected frame, not a silently generic render.
    for (const invalid of [{ kind: 'plan-review' }, { kind: 'poll', approve: 'Approve' }, { approve: 'Approve' }]) {
      expect(() => askUserQuestionItemSchema.parse({ id: 'q', question: 'Q?', intent: invalid })).toThrow()
    }
  })

  it('accepts every queue placement and rejects unknown placements', () => {
    const item = (placement: string) => ({ type: 'session/queue', sessionId: 's', items: [{
      id: 'm', placement,
      message: { id: 'm', role: 'user', content: [], source: { kind: 'user' } },
    }] })
    for (const placement of ['queued', 'steering', 'context']) {
      expect(() => muxFrameSchema.parse(item(placement))).not.toThrow()
    }
    expect(() => muxFrameSchema.parse(item('bogus'))).toThrow()
  })

  it('rejects a queue snapshot with malformed items', () => {
    expect(() => muxFrameSchema.parse({ type: 'session/queue', sessionId: 's', items: 'x' })).toThrow()
    expect(() => muxFrameSchema.parse({ type: 'session/queue', sessionId: 's', items: [{ id: '', role: 'user', content: [], source: { kind: 'user' } }] })).toThrow()
    expect(() => muxFrameSchema.parse({ type: 'session/queue', sessionId: 's', items: [{ id: 'm', role: 'assistant', content: [], source: { kind: 'user' } }] })).toThrow()
  })

  it('accepts every host frame branch', () => {
    const frames = [
      { type: 'host/session-added', sessionId: 's', blank: true, parentSessionId: 'p' },
      { type: 'host/session-added', sessionId: 's', blank: true },
      { type: 'host/session-removed', sessionId: 's' },
      { type: 'host/session-status', sessionId: 's', running: true },
      { type: 'host/agent-error', sessionId: 's', message: 'boom' },
      { type: 'host/workspace-changed', workspace: {
        workspaceId: 'w', path: '/w', title: 'w', sessionIds: [],
        createdAt: '0', updatedAt: '0',
      } },
      { type: 'host/workspace-removed', workspaceId: 'w' },
      { type: 'host/remote-event', event: 'commands/change', args: [] },
      { type: 'host/remote-event', event: 'settings/document-updated', args: ['ns', 3] },
      { type: 'host/remote-event', event: 'agent-preset/selected', args: ['s', 'minimal'] },
      { type: 'host/remote-event', event: 'llm/adapters-updated', args: [] },
      { type: 'stream/error', error: { code: 'internal', message: 'm', details: {} } },
    ]
    for (const frame of frames) expect(hostFrameSchema.parse(frame)).toMatchObject({ type: frame.type })
  })
})

describe('respond payload schemas', () => {
  it('validates approval and question answer payloads', () => {
    expect(approvalRequestIdSchema.parse('a1')).toBe('a1')
    const approval = approvalResponsePayloadSchema.parse({ sessionId: 's', approvalId: 'a', outcome: 'rejected' })
    expect(approval.outcome).toBe('rejected')
    expect(() => approvalResponsePayloadSchema.parse({ sessionId: 's', approvalId: 'a', outcome: 'cancelled' })).toThrow()
    const answer = askUserQuestionAnswerSchema.parse({ answers: [{ id: 'q', selected: ['x'], custom: 'c' }] })
    expect(answer.answers[0]?.selected).toEqual(['x'])
    const payload = questionResponsePayloadSchema.parse({ sessionId: 's', answer: { answers: [] } })
    expect(payload.sessionId).toBe('s')
  })
})

describe('agent-preset schemas', () => {
  it('accepts a roster row and rejects an unknown trust', () => {
    expect(agentPresetEntrySchema.parse({ id: 'standard', trust: 'system', isDefault: true }))
      .toEqual({ id: 'standard', trust: 'system', isDefault: true })
    expect(() => agentPresetEntrySchema.parse({ id: 'x', trust: 'root', isDefault: false })).toThrow()
    expect(() => agentPresetEntrySchema.parse({ id: '', trust: 'user', isDefault: false })).toThrow()
  })

  it('accepts an empty roster', () => {
    // A deployment composing no presets still reports its authoring and
    // native-open capabilities, so a surface knows what to offer.
    expect(agentPresetListValueSchema.parse({ presets: [], authorable: false, hasDocument: false }))
      .toEqual({ presets: [], authorable: false, hasDocument: false })
  })

  it('answers the open-document union by its discriminant', () => {
    expect(agentPresetOpenDocumentValueSchema.parse({ opened: true })).toEqual({ opened: true })
    expect(agentPresetOpenDocumentValueSchema.parse({ opened: false, path: '/presets/mine' }))
      .toEqual({ opened: false, path: '/presets/mine' })
    // A closed reply must carry the path the surface shows instead.
    expect(() => agentPresetOpenDocumentValueSchema.parse({ opened: false })).toThrow()
  })
})
