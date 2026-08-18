import { describe, expect, it } from 'vitest'
import {
  type NormalizeContext,
  extractSnapshotSpillPaths,
  normalizeSessionLog,
  normalizeStdout,
  scrubRequestHeaders,
  scrubSystemPrompts,
  scrubToolSchemas,
  tokenizeSessionFixtureCwd,
} from '../src/normalize.ts'

/**
 * Unit tests for the pure snapshot normalizers. Live as a *.spec.ts (runs in
 * the default unit gate) and import the normalizers directly.
 */

const ctx: NormalizeContext = {
  sessionIds: ['11111111-2222-3333-4444-555555555555'],
  cwd: '/tmp/acp-snap-cwd-abc123',
}

describe('normalizeStdout', () => {
  it('rewrites JSON-RPC ids to a stable first-seen sequence', () => {
    const raw = [
      JSON.stringify({ jsonrpc: '2.0', id: 42, method: 'initialize' }),
      JSON.stringify({ jsonrpc: '2.0', id: 42, result: {} }),
      JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'session/new' }),
    ].join('\n')
    const out = normalizeStdout(raw, ctx)
    expect(out).toContain('"id":1')
    expect(out).toContain('"id":2')
    expect(out).not.toContain('42')
    expect(out).not.toContain('99')
  })

  it('scrubs the cwd and session id anywhere they appear', () => {
    const raw = JSON.stringify({
      jsonrpc: '2.0', method: 'session/update',
      params: { sessionId: ctx.sessionIds[0], cwd: ctx.cwd, note: `at ${ctx.cwd}/x` },
    })
    const out = normalizeStdout(raw, ctx)
    expect(out).toContain('{{sessionId}}')
    expect(out).toContain('{{cwd}}')
    expect(out).not.toContain(ctx.cwd)
    expect(out).not.toContain(ctx.sessionIds[0] as string)
  })

  it('scrubs cwd at file URI and chained-punctuation boundaries', () => {
    const raw = JSON.stringify({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        uri: `file://${ctx.cwd}/proof.txt`,
        punctuated: `${ctx.cwd}.,`,
        dottedSegment: `${ctx.cwd}.backup`,
        dashedSegment: `${ctx.cwd}-backup`,
      },
    })
    const frame = JSON.parse(normalizeStdout(raw, ctx)) as {
      params: Record<string, string>
    }
    expect(frame.params).toEqual({
      uri: 'file://{{cwd}}/proof.txt',
      punctuated: '{{cwd}}.,',
      dottedSegment: `${ctx.cwd}.backup`,
      dashedSegment: `${ctx.cwd}-backup`,
    })
  })

  it('scrubs every filesystem spelling of the cwd longest-first', () => {
    const longCwd = String.raw`C:\Users\runneradmin\AppData\Local\Temp\acp-snapshot`
    const aliasedCtx: NormalizeContext = {
      sessionIds: [],
      cwd: String.raw`C:\Users\RUNNER~1\AppData\Local\Temp\acp-snapshot`,
      cwdAliases: [
        longCwd,
        String.raw`C:\Users\runneradmin\AppData\Local\Temp\acp`,
      ],
    }
    const raw = JSON.stringify({
      cwd: longCwd,
      path: `${longCwd}\\nested\\proof.txt`,
    })
    const frame = JSON.parse(normalizeStdout(raw, aliasedCtx)) as { cwd: string; path: string }
    expect(frame).toEqual({ cwd: '{{cwd}}', path: '{{cwd}}/nested/proof.txt' })
  })

  it('canonicalizes only cwd-rooted path separators', () => {
    const windowsCtx: NormalizeContext = {
      sessionIds: [],
      cwd: String.raw`C:\Users\runner\AppData\Local\Temp\acp-snapshot`,
    }
    const raw = JSON.stringify({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        path: `${windowsCtx.cwd}\\nested\\proof.txt`,
        regex: String.raw`\d+\w+`,
        command: String.raw`printf "\\n"`,
      },
    })
    const frame = JSON.parse(normalizeStdout(raw, windowsCtx)) as {
      params: { path: string; regex: string; command: string }
    }
    expect(frame.params).toEqual({
      path: '{{cwd}}/nested/proof.txt',
      regex: String.raw`\d+\w+`,
      command: String.raw`printf "\\n"`,
    })
  })

  it('canonicalizes generated relative path fields and text markers without rewriting other text', () => {
    const raw = JSON.stringify({
      path: String.raw`nested\AGENTS.md`,
      content: String.raw`<path>.\nested\task.txt</path>
Additional instructions from: nested\AGENTS.md`,
      regex: String.raw`\d+\w+`,
    })
    const frame = JSON.parse(normalizeStdout(raw, { sessionIds: [], cwd: '/unused' })) as {
      path: string
      content: string
      regex: string
    }
    expect(frame).toEqual({
      path: 'nested/AGENTS.md',
      content: '<path>./nested/task.txt</path>\nAdditional instructions from: nested/AGENTS.md',
      regex: String.raw`\d+\w+`,
    })
  })

  it('can preserve native cwd-rooted separators for a platform golden', () => {
    const windowsCtx: NormalizeContext = { sessionIds: [], cwd: String.raw`C:\work\snapshot` }
    const raw = JSON.stringify({ path: `${windowsCtx.cwd}\\nested\\proof.txt` })
    const frame = JSON.parse(normalizeStdout(raw, windowsCtx, { cwdPathMode: 'native' })) as { path: string }
    expect(frame.path).toBe(String.raw`{{cwd}}\nested\proof.txt`)
  })

  it('scrubs a stray UUID not in the known list', () => {
    const raw = JSON.stringify({ jsonrpc: '2.0', method: 'x', params: { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' } })
    expect(normalizeStdout(raw, ctx)).toContain('{{sessionId}}')
  })

  it('leaves notification frames without an id untouched in id-space', () => {
    const raw = JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: {} })
    const out = normalizeStdout(raw, ctx)
    expect(out).not.toContain('"id"')
  })

  it('stabilizes only the top-level event timestamp and spill byte count in event-read text', () => {
    const raw = JSON.stringify({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        update: {
          sessionUpdate: 'tool_call_update',
          content: [{
            type: 'content',
            content: {
              type: 'text',
              text: 'Session prior — title\nTarget event seq 4:\n```json\n{\n  "seq": 4,\n  "time": 1784876275593,\n  "data": {\n    "time": 31337,\n    "note": "model-visible"\n  }\n}\n```\n\nAfter:\n  "time": 424242,\n  neighbor semantic text\n\n(Omitted 39387 bytes. Full formatted result stored at: /tmp/result.txt.)',
            },
          }],
        },
      },
    })
    const out = normalizeStdout(raw, ctx)
    expect(out).toContain('\\"time\\": {{eventTime}}')
    expect(out).toContain('\\"time\\": 31337')
    expect(out).toContain('\\"time\\": 424242')
    expect(out).toContain('Omitted {{eventOmittedBytes}} bytes')
    expect(out).not.toContain('1784876275593')
    expect(out).not.toContain('39387')
  })

  it('preserves event-like timestamps in unrelated output text', () => {
    const raw = JSON.stringify({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        update: {
          sessionUpdate: 'tool_call_update',
          content: [{
            type: 'content',
            content: {
              type: 'text',
              text: 'bash output:\n```json\n{\n  "time": 1784876275593,\n  "data": {}\n}\n```\n\n(Omitted 39387 bytes. Full formatted result stored at: /tmp/result.txt.)',
            },
          }],
        },
      },
    })
    const out = normalizeStdout(raw, ctx)
    expect(out).toContain('1784876275593')
    expect(out).toContain('39387')
    expect(out).not.toContain('{{eventTime}}')
    expect(out).not.toContain('{{eventOmittedBytes}}')
  })

  it('throws on a non-JSON stdout line (the purity check)', () => {
    const raw = `${JSON.stringify({ jsonrpc: '2.0', id: 1 })}\noops a log leaked\n`
    expect(() => normalizeStdout(raw, ctx)).toThrow()
  })

  it('ignores blank lines', () => {
    const raw = `\n${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'm' })}\n\n`
    expect(() => normalizeStdout(raw, ctx)).not.toThrow()
  })
})

describe('normalizeSessionLog', () => {
  const header = (over: object) => JSON.stringify({ type: 'session', version: 0, id: 's', createdAt: 123, ...over })
  const event = (over: object) => JSON.stringify({ type: 'turn/start', seq: 1, time: 999, data: { turn: 1 }, ...over })

  it('zeroes the header createdAt', () => {
    const out = normalizeSessionLog(`${header({})}\n`, ctx)
    expect(out).toContain('"createdAt":0')
    expect(out).not.toContain('123')
  })

  it('zeroes each event time but keeps seq', () => {
    const out = normalizeSessionLog(`${header({})}\n${event({ seq: 7, time: 999 })}\n`, ctx)
    expect(out).toContain('"time":0')
    expect(out).toContain('"seq":7') // seq is deterministic — NOT scrubbed
    expect(out).not.toContain('999')
  })

  it('scrubs cwd and session id deep inside event data', () => {
    const ev = JSON.stringify({
      type: 'tool/result', seq: 2, time: 5,
      data: { content: [{ type: 'text', text: `wrote ${ctx.cwd}/proof.txt` }] },
    })
    const out = normalizeSessionLog(`${header({ cwd: ctx.cwd })}\n${ev}\n`, ctx)
    expect(out).toContain('{{cwd}}')
    expect(out).not.toContain(ctx.cwd)
  })

  it('scrubs cwd at file URI and chained-punctuation boundaries in event data', () => {
    const ev = JSON.stringify({
      type: 'tool/result',
      seq: 2,
      time: 5,
      data: {
        uri: `file://${ctx.cwd}/proof.txt`,
        punctuated: `${ctx.cwd}.,`,
      },
    })
    const out = normalizeSessionLog(`${header({ cwd: ctx.cwd })}\n${ev}\n`, ctx)
    expect(out).toContain('file://{{cwd}}/proof.txt')
    expect(out).toContain('{{cwd}}.,')
    expect(out).not.toContain(`file://${ctx.cwd}`)
  })

  it('scrubs random local spill paths under the snapshot cwd', () => {
    const ev = JSON.stringify({
      type: 'tool/result', seq: 2, time: 5,
      data: {
        content: [{
          type: 'text',
          text: `Full formatted result stored at: ${ctx.cwd}/.spill/session-c22bc3f1d2af/8a7b6c5d4e3f-bash.txt. Use read with offset/limit, or grep this path to search within it.`,
        }],
      },
    })
    const out = normalizeSessionLog(`${header({ cwd: ctx.cwd })}\n${ev}\n`, ctx)
    expect(out).toContain('{{spillLocator:bash.txt}}')
    expect(out).not.toContain('session-c22bc3f1d2af')
    expect(out).not.toContain('8a7b6c5d4e3f')
  })

  it('scrubs macOS /private aliases for local spill paths', () => {
    const ev = JSON.stringify({
      type: 'tool/result', seq: 2, time: 5,
      data: {
        content: [{
          type: 'text',
          text: `Full formatted result stored at: /private${ctx.cwd}/.spill/session-c22bc3f1d2af/8a7b6c5d4e3f-bash.txt. Use read with offset/limit, or grep this path to search within it.`,
        }],
      },
    })
    const out = normalizeSessionLog(`${header({ cwd: ctx.cwd })}\n${ev}\n`, ctx)
    expect(out).toContain('{{spillLocator:bash.txt}}')
    expect(out).not.toContain('/private{{spillLocator')
  })

  it('scrubs macOS /private prefix on cwd-rooted fs tool result paths', () => {
    const ev = JSON.stringify({
      type: 'tool/result', seq: 2, time: 5,
      data: {
        content: [{
          type: 'text',
          text: `The file /private${ctx.cwd}/config.txt has been updated successfully.`,
        }],
      },
    })
    const out = normalizeSessionLog(`${header({ cwd: ctx.cwd })}\n${ev}\n`, ctx)
    expect(out).toContain('{{cwd}}/config.txt')
    expect(out).not.toContain('/private{{cwd}}')
  })

  it('scrubs fixed snapshot spill paths', () => {
    const ev = JSON.stringify({
      type: 'tool/result', seq: 2, time: 5,
      data: {
        content: [{
          type: 'text',
          text: 'Full formatted result stored at: /tmp/dsh-acp-snapshot-spill/session-c22bc3f1d2af/8a7b6c5d4e3f-bash.txt. Use read with offset/limit, or grep this path to search within it.',
        }],
      },
    })
    const out = normalizeSessionLog(`${header({ cwd: ctx.cwd })}\n${ev}\n`, ctx)
    expect(out).toContain('{{spillLocator:bash.txt}}')
    expect(out).not.toContain('/tmp/dsh-acp-snapshot-spill')
  })

  it('scrubs scenario-owned snapshot spill paths', () => {
    const ev = JSON.stringify({
      type: 'tool/result', seq: 2, time: 5,
      data: {
        content: [{
          type: 'text',
          text: 'Full formatted result stored at: /tmp/dsh-acp-snap-012345678/session-c22bc3f1d2af/8a7b6c5d4e3f-bash.txt. Use read with offset/limit, or grep this path to search within it.',
        }],
      },
    })
    const out = normalizeSessionLog(`${header({ cwd: ctx.cwd })}\n${ev}\n`, ctx)
    expect(out).toContain('{{spillLocator:bash.txt}}')
    expect(out).not.toContain('/tmp/dsh-acp-snap-012345678')
  })

  it('scrubs scenario-owned snapshot spill paths with Windows drive and separators', () => {
    const ev = JSON.stringify({
      type: 'tool/result', seq: 2, time: 5,
      data: {
        content: [{
          type: 'text',
          text: String.raw`Full formatted result stored at: C:\t\dsh-acp-snap-012345678\session-c22bc3f1d2af\8a7b6c5d4e3f-bash.txt. Use read with offset/limit, or grep this path to search within it.`,
        }],
      },
    })
    const out = normalizeSessionLog(`${header({ cwd: ctx.cwd })}\n${ev}\n`, ctx)
    expect(out).toContain('{{spillLocator:bash.txt}}')
    expect(out).not.toContain('C:\\t\\dsh-acp-snap-012345678')
  })

  it('shares cwd-rooted path handling with stdout normalization', () => {
    const windowsCtx: NormalizeContext = { sessionIds: [], cwd: String.raw`C:\work\snapshot` }
    const ev = JSON.stringify({
      type: 'tool/result', seq: 2, time: 5,
      data: { path: `${windowsCtx.cwd}\\nested\\proof.txt` },
    })
    expect(normalizeSessionLog(`${header({ cwd: windowsCtx.cwd })}\n${ev}\n`, windowsCtx))
      .toContain('{{cwd}}/nested/proof.txt')
    expect(normalizeSessionLog(`${header({ cwd: windowsCtx.cwd })}\n${ev}\n`, windowsCtx, { cwdPathMode: 'native' }))
      .toContain(String.raw`{{cwd}}\\nested\\proof.txt`)
  })

  it('scrubs the session id in the header', () => {
    const out = normalizeSessionLog(`${header({ id: ctx.sessionIds[0] })}\n`, ctx)
    expect(out).toContain('{{sessionId}}')
  })

  it('zeroes a hook/result durationMs (run-to-run noise) but keeps its decision', () => {
    const ev = JSON.stringify({
      type: 'hook/result', seq: 2, time: 5,
      data: { turn: 1, point: 'UserPromptSubmit', handlerId: 'h', decision: 'block', exitCode: 2, durationMs: 37 },
    })
    const out = normalizeSessionLog(`${header({})}\n${ev}\n`, ctx)
    expect(out).toContain('"durationMs":0')
    expect(out).not.toContain('37')
    expect(out).toContain('"decision":"block"') // the decision is the behavior — kept
  })

  it('zeroes a packed chunk row\'s time0 and dt gaps but keeps seq0 and payload', () => {
    const row = JSON.stringify({
      type: 'text-chunks', seq0: 7, time0: 999,
      data: { turn: 1, step: 1, index: 0, dt: [212, 27, 0], texts: ['a', 'b', 'c', 'd'] },
    })
    const out = normalizeSessionLog(`${header({})}\n${row}\n`, ctx)
    expect(out).toContain('"time0":0')
    expect(out).toContain('"dt":[0,0,0]')
    expect(out).toContain('"seq0":7') // seq0 is deterministic, like seq — NOT scrubbed
    expect(out).toContain('"texts":["a","b","c","d"]')
    expect(out).not.toContain('999')
    expect(out).not.toContain('212')
  })

  it('zeroes time0 even when a malformed row carries no dt array', () => {
    const row = JSON.stringify({ type: 'text-chunks', seq0: 1, time0: 999, data: 'not-an-object' })
    const out = normalizeSessionLog(`${header({})}\n${row}\n`, ctx)
    expect(out).toContain('"time0":0')
    expect(out).not.toContain('999')
  })

  it('leaves a non-hook event durationMs untouched (only hook/result is scrubbed)', () => {
    const ev = JSON.stringify({ type: 'tool/result', seq: 2, time: 5, data: { durationMs: 88 } })
    const out = normalizeSessionLog(`${header({})}\n${ev}\n`, ctx)
    expect(out).toContain('"durationMs":88')
  })

  it('tolerates records missing the volatile fields it would zero', () => {
    const bareHeader = JSON.stringify({ type: 'session', id: 's' })
    const timeless = JSON.stringify({ type: 'note', seq: 1 })
    const bareHook = JSON.stringify({ type: 'hook/result', seq: 2, time: 5, data: { decision: 'allow' } })
    const nullDataHook = JSON.stringify({ type: 'hook/result', seq: 3, time: 6, data: null })
    const out = normalizeSessionLog(`${bareHeader}\n${timeless}\n${bareHook}\n${nullDataHook}\n`, ctx)
    expect(out).toContain('"type":"note","seq":1')
    expect(out).toContain('"decision":"allow"')
    expect(out).not.toContain('durationMs')
  })
})

describe('tokenizeSessionFixtureCwd', () => {
  it.each([
    {
      name: 'macOS',
      context: {
        sessionIds: [],
        cwd: '/var/folders/2g/snapshot/T/acp-snap-cwd-abc123',
        cwdAliases: ['/private/var/folders/2g/snapshot/T/acp-snap-cwd-abc123'],
      },
      reportedCwd: '/private/var/folders/2g/snapshot/T/acp-snap-cwd-abc123',
    },
    {
      name: 'Linux',
      context: {
        sessionIds: [],
        cwd: '/tmp/acp-snap-cwd-abc123',
      },
      reportedCwd: '/tmp/acp-snap-cwd-abc123',
    },
    {
      name: 'Windows',
      context: {
        sessionIds: [],
        cwd: String.raw`C:\Users\runner\AppData\Local\Temp\acp-snap-cwd-abc123`,
      },
      reportedCwd: String.raw`C:\Users\runner\AppData\Local\Temp\acp-snap-cwd-abc123`,
    },
  ])('stores $name temporary workspaces with one portable root token', ({ context, reportedCwd }) => {
    const raw = [
      JSON.stringify({ type: 'session', id: 's', createdAt: 1, cwd: context.cwd }),
      JSON.stringify({
        type: 'tool/result',
        seq: 1,
        time: 2,
        data: {
          content: [{
            type: 'text',
            text: `wrote ${reportedCwd}/proof.txt. alias /different/root/acp-snap-cwd-abc123/alias.txt. cwd ${context.cwd}. Next; kept ${context.cwd}-backup, ${context.cwd}.backup, and /tmp/authored.txt`,
          }],
        },
      }),
      '',
    ].join('\n')

    const out = tokenizeSessionFixtureCwd(raw)
    const result = JSON.parse(out.split('\n')[1] as string) as {
      data: { content: { text: string }[] }
    }
    const resultText = (result.data.content[0] as { text: string }).text

    expect(out).toContain('"cwd":"{{cwd}}"')
    expect(resultText).toContain('wrote {{cwd}}/proof.txt')
    expect(resultText).toContain('alias {{cwd}}/alias.txt')
    expect(resultText).toContain('cwd {{cwd}}. Next')
    expect(resultText).toContain(`${context.cwd}-backup`)
    expect(resultText).toContain(`${context.cwd}.backup`)
    expect(resultText).toContain('/tmp/authored.txt')
    expect(resultText).not.toContain(`${reportedCwd}/proof.txt`)
    expect(tokenizeSessionFixtureCwd(out)).toBe(out)
  })

  it('collapses a residual macOS realpath prefix around an existing cwd token', () => {
    const raw = [
      JSON.stringify({ type: 'session', id: 's', createdAt: 1, cwd: '{{cwd}}' }),
      JSON.stringify({
        type: 'tool/result',
        seq: 1,
        time: 2,
        data: { content: [{ type: 'text', text: 'wrote /private{{cwd}}/proof.txt' }] },
      }),
      '',
    ].join('\n')

    const out = tokenizeSessionFixtureCwd(raw)
    expect(out).toContain('wrote {{cwd}}/proof.txt')
    expect(out).not.toContain('/private{{cwd}}')
    expect(tokenizeSessionFixtureCwd(out)).toBe(out)
  })

  it('rejects a log without a session cwd', () => {
    expect(() => tokenizeSessionFixtureCwd('')).toThrow(
      'acp-snapshot: cannot tokenize a cwd without a basename',
    )
  })
})

describe('extractSnapshotSpillPaths', () => {
  it('maps each spill filename to its full matched path, last match wins per name', () => {
    const log = [
      'Full formatted result stored at: /tmp/dsh-acp-snapshot-spill/session-c22bc3f1d2af/8a7b6c5d4e3f-bash.txt. Use read with offset/limit, or grep this path to search within it.',
      'stale copy at /tmp/dsh-acp-snap-012345678/session-aaaaaaaaaaaa/bbbbbbbbbbbb-grep.txt then',
      'fresh copy at /tmp/dsh-acp-snap-012345678/session-cccccccccccc/dddddddddddd-grep.txt then',
    ].join('\n')
    expect(extractSnapshotSpillPaths(log)).toEqual(new Map([
      ['bash.txt', '/tmp/dsh-acp-snapshot-spill/session-c22bc3f1d2af/8a7b6c5d4e3f-bash.txt'],
      ['grep.txt', '/tmp/dsh-acp-snap-012345678/session-cccccccccccc/dddddddddddd-grep.txt'],
    ]))
  })

  it('returns an empty map when the log carries no snapshot spill paths', () => {
    expect(extractSnapshotSpillPaths('no spill paths here, only /tmp/other.txt\n')).toEqual(new Map())
  })
})

describe('scrubRequestHeaders', () => {
  const headerLine = JSON.stringify({ type: 'session', version: 0, id: 's', createdAt: 1, cwd: '/w' })
  const headerEvent = (header: object) =>
    JSON.stringify({ type: 'request/header', seq: 3, time: 9, data: { header, reason: 'initial' } })

  it('replaces header system and tools with tokens, keeping config and reason', () => {
    const ev = headerEvent({
      config: { model: 'm' },
      system: 'You are an agent.\nBe brief.',
      tools: [{ name: 'read', description: 'Read a file.', parameters: { type: 'object' } }],
    })
    const out = scrubRequestHeaders(`${headerLine}\n${ev}\n`)
    expect(out).toContain('"system":"{{system}}"')
    expect(out).toContain('"tools":"{{tools}}"')
    expect(out).toContain('"config":{"model":"m"}')
    expect(out).toContain('"reason":"initial"')
    expect(out).not.toContain('You are an agent')
    expect(out).not.toContain('Read a file')
  })

  it('keeps an absent system/tools absent (presence is behavior)', () => {
    const out = scrubRequestHeaders(`${headerLine}\n${headerEvent({ config: { model: 'm' } })}\n`)
    expect(out).not.toContain('{{system}}')
    expect(out).not.toContain('{{tools}}')
  })

  it('scrubs a header carrying only one of system/tools, leaving the other absent', () => {
    const systemOnly = scrubRequestHeaders(`${headerLine}\n${headerEvent({ system: 'secret prompt' })}\n`)
    expect(systemOnly).toContain('"system":"{{system}}"')
    expect(systemOnly).not.toContain('{{tools}}')
    const toolsOnly = scrubRequestHeaders(`${headerLine}\n${headerEvent({ tools: [{ name: 't' }] })}\n`)
    expect(toolsOnly).toContain('"tools":"{{tools}}"')
    expect(toolsOnly).not.toContain('{{system}}')
  })

  it('leaves malformed headers with no scrubbable payload byte-identical', () => {
    const headerless = JSON.stringify({ type: 'request/header', seq: 10, time: 9, data: { reason: 'initial' } })
    const nullData = JSON.stringify({ type: 'request/header', seq: 11, time: 9, data: null })
    const raw = `${headerLine}\n${headerless}\n${nullData}\n`
    expect(scrubRequestHeaders(raw)).toBe(raw)
  })

  it('passes every other line through byte-for-byte and is idempotent', () => {
    const other = JSON.stringify({ type: 'assistant/chunk', seq: 4, time: 9, data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'hi' } } })
    const raw = `${headerLine}\n${headerEvent({ config: { model: 'm' }, system: 's', tools: [] })}\n${other}\n`
    const once = scrubRequestHeaders(raw)
    expect(once.split('\n')[0]).toBe(headerLine)
    expect(once.split('\n')[2]).toBe(other)
    expect(scrubRequestHeaders(once)).toBe(once)
  })
})

describe('scrubSystemPrompts', () => {
  it('scrubs only system prompt payloads while keeping tools verbatim', () => {
    const header = JSON.stringify({
      type: 'request/header', seq: 1, time: 2,
      data: {
        header: {
          system: 'full prompt',
          tools: [{ name: 'read', description: 'full schema' }],
        },
        reason: 'initial',
      },
    })
    const changed = JSON.stringify({
      type: 'request/header', seq: 2, time: 3,
      data: {
        header: {
          system: 'new prompt',
          tools: [{ name: 'read', description: 'changed schema' }],
        },
        reason: 'change',
      },
    })
    const toolsOnly = JSON.stringify({
      type: 'request/header', seq: 3, time: 4,
      data: { header: { tools: [{ name: 'read', description: 'schema only' }] }, reason: 'resume' },
    })

    const out = scrubSystemPrompts(`${header}\n${changed}\n${toolsOnly}\n`)
    expect(out).toContain('"system":"{{system}}"')
    expect(out).not.toContain('full prompt')
    expect(out).not.toContain('new prompt')
    expect(out).toContain('full schema')
    expect(out).toContain('changed schema')
    expect(out.split('\n')[2]).toBe(toolsOnly)
    expect(scrubSystemPrompts(out)).toBe(out)
  })
})

describe('scrubToolSchemas', () => {
  it('scrubs only tool-schema payloads while keeping prompts verbatim', () => {
    const header = JSON.stringify({
      type: 'request/header', seq: 1, time: 2,
      data: {
        header: {
          system: 'full prompt',
          tools: [{ name: 'read', description: 'full schema', parameters: { type: 'object' } }],
        },
        reason: 'initial',
      },
    })
    const changed = JSON.stringify({
      type: 'request/header', seq: 2, time: 3,
      data: {
        header: {
          system: 'new prompt',
          tools: [{ name: 'grep', description: 'new schema' }],
        },
        reason: 'change',
      },
    })
    const systemOnly = JSON.stringify({
      type: 'request/header', seq: 3, time: 4,
      data: { header: { system: 'prompt only' }, reason: 'resume' },
    })

    const out = scrubToolSchemas(`${header}\n${changed}\n${systemOnly}\n`)
    expect(out.match(/"tools":"{{tools}}"/g)).toHaveLength(2)
    expect(out).not.toContain('full schema')
    expect(out).not.toContain('new schema')
    expect(out).toContain('full prompt')
    expect(out).toContain('new prompt')
    expect(out.split('\n')[2]).toBe(systemOnly)
    expect(scrubToolSchemas(out)).toBe(out)
  })
})
