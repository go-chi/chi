/**
 * session.export host path: the GET download endpoint streams a ZIP whose
 * files are the stored artifacts verbatim (root + optional descendants), and
 * the degenerate compositions fail loudly (missing services → 500, missing
 * root → 404, missing descendant → errored stream).
 */

import { randomBytes } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { unzipSync, strFromU8 } from 'fflate'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionLineageNode } from '@deepseek-ai/dsh-session-query'
import type { SessionRawArtifact } from '@deepseek-ai/dsh-session-persistence'
import ApiProxyService, { createApiProxy, toFetchHandler } from '@deepseek-ai/dsh-host-apiproxy'

const sid = (id: string): SessionId => id as SessionId

function header(id: string, parentSession?: SessionId): SessionHeader {
  return {
    version: 0,
    id: sid(id),
    createdAt: 1000,
    cwd: '/proj',
    ...parentSession === undefined ? {} : { parentSession },
    delegationDepth: parentSession === undefined ? 0 : 1,
  }
}

function artifact(id: string, parentSession?: SessionId, content?: string): SessionRawArtifact {
  return {
    meta: header(id, parentSession),
    filename: 'session.jsonl',
    content: content ?? `{"type":"session","version":0,"id":"${id}","createdAt":1000}\n{"type":"turn/start","seq":0,"time":2000,"data":{"turn":1}}\n`,
  }
}

function node(id: string, ...descendants: SessionLineageNode[]): SessionLineageNode {
  return { session: { header: header(id, sid('session-root')), live: false, persisted: true }, descendants }
}

/** One durable image object served by the fake attachment store. */
function storedImage(id: string, mediaType: ImageAttachmentRef['mediaType'] = 'image/png') {
  return {
    ref: { attachmentId: sid(id), mediaType, bytes: 4, width: 2, height: 2 } as unknown as ImageAttachmentRef,
    data: new Uint8Array([1, 2, 3, 4]),
  }
}

/** A user/message event line carrying one image reference. */
function imageEventLine(id: string, mediaType: ImageAttachmentRef['mediaType'] = 'image/png'): string {
  return `{"type":"user/message","seq":1,"time":1000,"data":{"content":[{"type":"image","attachment":{"attachmentId":"${id}","mediaType":"${mediaType}","bytes":4,"width":2,"height":2}}]}}`
}

async function buildApi(
  artifacts: Record<string, SessionRawArtifact>,
  descendants: SessionLineageNode[] = [],
  services: {
    query?: boolean
    persistence?: boolean | 'throw' | 'unsupported'
    attachments?: boolean | ((ref: ImageAttachmentRef, signal?: AbortSignal) => Promise<ReturnType<typeof storedImage>>)
    sessions?: {
      get(id: SessionId): { readonly id: SessionId } | undefined
      flush(session: { readonly id: SessionId }): Promise<boolean>
    }
    readRaw?: (id: SessionId, signal?: AbortSignal) => Promise<SessionRawArtifact | undefined>
    traceSession?: (id: SessionId, signal?: AbortSignal) => Promise<{
      target: { header: SessionHeader; live: boolean; persisted: boolean }
      ancestors: readonly SessionLineageNode[]
      complete: boolean
      root: { header: SessionHeader; live: boolean; persisted: boolean }
      descendants: readonly SessionLineageNode[]
    }>
    compressionLevel?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
  } = {},
) {
  const ctx = new Context()
  await ctx.plugin(UserQuestionService)
  const query = services.query ?? true
  const persistence = services.persistence ?? true
  if (query) {
    ctx.provide('sessionQuery', {
      traceSession: services.traceSession ?? (async () => ({
        target: { header: header('session-root'), live: false, persisted: true },
        ancestors: [],
        complete: true,
        root: { header: header('session-root'), live: false, persisted: true },
        descendants,
      })),
    } as never)
  }
  if (persistence) {
    ctx.provide('sessionPersistence', {
      supportsRawArtifacts: persistence !== 'unsupported',
      readRaw: services.readRaw ?? (async (id: SessionId) => {
        if (persistence === 'throw') throw new Error('/host/private/session.jsonl')
        return artifacts[id]
      }),
    } as never)
  }
  if (services.attachments !== false) {
    const readImage = typeof services.attachments === 'function'
      ? services.attachments
      : async (ref: ImageAttachmentRef) => storedImage(String(ref.attachmentId), ref.mediaType)
    ctx.provide('attachments', {
      imageLimits: {} as never,
      validateImage: async () => {},
      saveImage: async () => { throw new Error('export never saves images') },
      readImage,
    } as never)
  }
  if (services.sessions !== undefined) ctx.provide('sessions', services.sessions as never)
  return createApiProxy(ctx, {
    defaultModelSelection: () => ({ provider: 'p', model: 'm' }),
    cwd: '/tmp',
    ...services.compressionLevel === undefined
      ? {}
      : { sessionExportCompressionLevel: services.compressionLevel },
  })
}

async function responseBytes(response: Response): Promise<Uint8Array> {
  return new Uint8Array(await response.arrayBuffer())
}

describe('session export compression config', () => {
  it('defaults to level 6 and rejects values outside the integer 0-9 range', () => {
    expect(ApiProxyService.Config({})).toEqual({
      sessionExportCompressionLevel: 6,
      coldBlankProbeMaxBytes: 1024,
    })
    expect(ApiProxyService.Config({ sessionExportCompressionLevel: 0 }))
      .toEqual({ sessionExportCompressionLevel: 0, coldBlankProbeMaxBytes: 1024 })
    expect(ApiProxyService.Config({ sessionExportCompressionLevel: 9 }))
      .toEqual({ sessionExportCompressionLevel: 9, coldBlankProbeMaxBytes: 1024 })
    for (const value of [-1, 10, 1.5]) {
      expect(() => ApiProxyService.Config({ sessionExportCompressionLevel: value } as never)).toThrow()
    }
  })
})

describe('cold blank probe config', () => {
  it('accepts a per-Session byte bound including zero and rejects invalid bounds', () => {
    expect(ApiProxyService.Config({ coldBlankProbeMaxBytes: 0 }))
      .toEqual({ sessionExportCompressionLevel: 6, coldBlankProbeMaxBytes: 0 })
    expect(ApiProxyService.Config({ coldBlankProbeMaxBytes: 2048 }))
      .toEqual({ sessionExportCompressionLevel: 6, coldBlankProbeMaxBytes: 2048 })
    for (const value of [-1, 1.5]) {
      expect(() => ApiProxyService.Config({ coldBlankProbeMaxBytes: value })).toThrow()
    }
  })
})

describe('session.export download endpoint', () => {
  it('streams a ZIP with the root artifact verbatim under its original filename', async () => {
    const api = await buildApi({ 'session-root': artifact('session-root') })
    const response = await toFetchHandler(api).fetch(
      new Request('http://host/api/session.export?sessionId=session-root'),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/zip')
    expect(response.headers.get('content-disposition')).toContain('dsh-session-session-root.zip')
    const files = unzipSync(await responseBytes(response))
    expect(Object.keys(files)).toEqual(['session.jsonl'])
    expect(strFromU8(files['session.jsonl'] as Uint8Array)).toBe(artifact('session-root').content)
  })

  it('preflights root preparation through HEAD without streaming a body', async () => {
    const readRaw = vi.fn(async () => artifact('session-root'))
    const api = await buildApi({}, [], { readRaw })
    const response = await toFetchHandler(api).fetch(
      new Request('http://host/api/session.export?sessionId=session-root', { method: 'HEAD' }),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/zip')
    expect(response.headers.get('content-disposition')).toContain('dsh-session-session-root.zip')
    expect(response.body).toBeNull()
    expect(readRaw).toHaveBeenCalledOnce()
  })

  it('returns a bodyless preparation error from HEAD', async () => {
    const api = await buildApi({})
    const response = await toFetchHandler(api).fetch(
      new Request('http://host/api/session.export?sessionId=session-root', { method: 'HEAD' }),
    )

    expect(response.status).toBe(404)
    expect(response.body).toBeNull()
  })

  it('uses the resolved compression level for ZIP entries', async () => {
    const root = artifact('session-root', undefined, 'compressible\n'.repeat(32 * 1024))
    const storedApi = await buildApi({ 'session-root': root }, [], { compressionLevel: 0 })
    const compressedApi = await buildApi({ 'session-root': root }, [], { compressionLevel: 9 })
    const stored = await storedApi.downloads.sessionLog(
      { sessionId: sid('session-root'), includeDescendants: false },
      new AbortController().signal,
    )
    const compressed = await compressedApi.downloads.sessionLog(
      { sessionId: sid('session-root'), includeDescendants: false },
      new AbortController().signal,
    )
    const storedBytes = await responseBytes(stored)
    const compressedBytes = await responseBytes(compressed)
    expect(compressedBytes.byteLength).toBeLessThan(storedBytes.byteLength)
    expect(strFromU8(unzipSync(compressedBytes)['session.jsonl'] as Uint8Array)).toBe(root.content)
  })

  it('includes descendant artifacts under subagents/<id>/ when requested', async () => {
    const api = await buildApi({
      'session-root': artifact('session-root'),
      'child-a': artifact('child-a', sid('session-root')),
      'grandchild-a': artifact('grandchild-a', sid('child-a')),
    }, [
      node('child-a', node('grandchild-a')),
    ])
    const response = await toFetchHandler(api).fetch(
      new Request('http://host/api/session.export?sessionId=session-root&includeDescendants=true'),
    )
    expect(response.status).toBe(200)
    const files = unzipSync(await responseBytes(response))
    expect(Object.keys(files).sort()).toEqual([
      'session.jsonl',
      'subagents/child-a/session.jsonl',
      'subagents/grandchild-a/session.jsonl',
    ])
    expect(strFromU8(files['subagents/child-a/session.jsonl'] as Uint8Array))
      .toBe(artifact('child-a').content)
  })

  it('flushes each live root and descendant immediately before reading its artifact', async () => {
    const stored: Record<string, SessionRawArtifact> = {
      'session-root': artifact('session-root', undefined, 'stale root'),
      'child-a': artifact('child-a', sid('session-root'), 'stale child'),
    }
    const durable: Record<string, SessionRawArtifact> = {
      'session-root': artifact('session-root', undefined, 'durable root'),
      'child-a': artifact('child-a', sid('session-root'), 'durable child'),
    }
    const flushed: SessionId[] = []
    const api = await buildApi(stored, [node('child-a')], {
      sessions: {
        get: id => durable[id] === undefined ? undefined : { id },
        flush: async (session) => {
          const artifactAfterFlush = durable[session.id]
          if (artifactAfterFlush === undefined) throw new Error('unexpected session')
          flushed.push(session.id)
          stored[session.id] = artifactAfterFlush
          return true
        },
      },
    })
    const response = await toFetchHandler(api).fetch(
      new Request('http://host/api/session.export?sessionId=session-root&includeDescendants=true'),
    )
    const files = unzipSync(await responseBytes(response))
    expect(flushed).toEqual([sid('session-root'), sid('child-a')])
    expect(strFromU8(files['session.jsonl'] as Uint8Array)).toBe('durable root')
    expect(strFromU8(files['subagents/child-a/session.jsonl'] as Uint8Array)).toBe('durable child')
  })

  it('reads a cold artifact without asking the live-session store to flush', async () => {
    const flush = vi.fn(async () => true)
    const root = artifact('session-root')
    const api = await buildApi({ 'session-root': root }, [], {
      sessions: {
        get: () => undefined,
        flush,
      },
    })
    const response = await api.downloads.sessionLog(
      { sessionId: sid('session-root'), includeDescendants: false },
      new AbortController().signal,
    )
    const files = unzipSync(await responseBytes(response))
    expect(flush).not.toHaveBeenCalled()
    expect(strFromU8(files['session.jsonl'] as Uint8Array)).toBe(root.content)
  })

  it('answers 404 for a missing root session', async () => {
    const api = await buildApi({})
    const response = await toFetchHandler(api).fetch(
      new Request('http://host/api/session.export?sessionId=session-root'),
    )
    expect(response.status).toBe(404)
  })

  it('answers 501 when the persistence backend has no per-session raw artifacts', async () => {
    const api = await buildApi({}, [], { persistence: 'unsupported' })
    const response = await toFetchHandler(api).fetch(
      new Request('http://host/api/session.export?sessionId=session-root'),
    )
    expect(response.status).toBe(501)
    expect(await response.text()).toContain('does not expose per-session raw artifacts')
  })

  it('answers 400 when the sessionId query parameter is absent', async () => {
    const api = await buildApi({ 'session-root': artifact('session-root') })
    const response = await toFetchHandler(api).fetch(
      new Request('http://host/api/session.export?includeDescendants=true'),
    )
    expect(response.status).toBe(400)
  })

  it('answers 400 for an includeDescendants value other than true or false', async () => {
    const api = await buildApi({ 'session-root': artifact('session-root') })
    const response = await toFetchHandler(api).fetch(
      new Request('http://host/api/session.export?sessionId=session-root&includeDescendants=1'),
    )
    expect(response.status).toBe(400)
  })

  it('answers 500 when the deployment mounts no persistence or session-query service', async () => {
    const api = await buildApi({}, [], { query: false, persistence: false })
    const response = await toFetchHandler(api).fetch(
      new Request('http://host/api/session.export?sessionId=session-root'),
    )
    expect(response.status).toBe(500)
    expect(await response.text()).toContain('session-query')
  })

  it('fails the whole export when a descendant has no stored artifact', async () => {
    const api = await buildApi({
      'session-root': artifact('session-root'),
    }, [node('child-missing')])
    const response = await toFetchHandler(api).fetch(
      new Request('http://host/api/session.export?sessionId=session-root&includeDescendants=true'),
    )
    expect(response.status).toBe(200)
    // The stream errors before completing, so the body read rejects rather
    // than returning a truncated-but-valid archive.
    await expect(response.arrayBuffer()).rejects.toThrow()
  })

  it('keeps an astral character whole when its surrogate pair straddles a push boundary', async () => {
    // The push loop slices by 2^16 code units and must back off one unit when
    // the boundary lands inside a surrogate pair; otherwise the pair re-encodes
    // as U+FFFD and the exported artifact is silently corrupted.
    const root = { ...artifact('session-root'), content: `${'a'.repeat((1 << 16) - 1)}😀tail` }
    const api = await buildApi({ 'session-root': root })
    const response = await toFetchHandler(api).fetch(
      new Request('http://host/api/session.export?sessionId=session-root'),
    )
    const files = unzipSync(await responseBytes(response))
    expect(strFromU8(files['session.jsonl'] as Uint8Array)).toBe(root.content)
  })

  it('splits a long artifact on a plain code-unit boundary without backoff', async () => {
    // A boundary that lands on a BMP character needs no surrogate backoff; the
    // round trip must still be byte-identical across the multi-chunk push.
    const root = { ...artifact('session-root'), content: 'z'.repeat((1 << 16) + 4096) }
    const api = await buildApi({ 'session-root': root })
    const response = await toFetchHandler(api).fetch(
      new Request('http://host/api/session.export?sessionId=session-root'),
    )
    const files = unzipSync(await responseBytes(response))
    expect(strFromU8(files['session.jsonl'] as Uint8Array)).toBe(root.content)
  })

  it('waits for response pull capacity before reading the next archive entry', async () => {
    const root = artifact('session-root', undefined, [
      imageEventLine('after-root'),
      randomBytes(512 * 1024).toString('base64'),
    ].join('\n'))
    let imageReads = 0
    const api = await buildApi({ 'session-root': root }, [], {
      attachments: async (ref) => {
        imageReads += 1
        return storedImage(String(ref.attachmentId), ref.mediaType)
      },
    })
    vi.useFakeTimers()
    let response: Response | undefined
    try {
      response = await toFetchHandler(api).fetch(
        new Request('http://host/api/session.export?sessionId=session-root'),
      )
      // Exhausting timer turns must not advance a producer whose byte queue is
      // full; only a consumer pull can release it.
      await vi.runAllTimersAsync()
      expect(imageReads).toBe(0)
    } finally {
      vi.useRealTimers()
    }
    if (response === undefined) throw new Error('missing export response')
    const files = unzipSync(await responseBytes(response))
    expect(imageReads).toBe(1)
    expect(files['media/after-root.png']).toEqual(storedImage('after-root').data)
  })

  it('exports an empty artifact as an empty zip entry', async () => {
    const root = { ...artifact('session-root'), content: '' }
    const api = await buildApi({ 'session-root': root })
    const response = await toFetchHandler(api).fetch(
      new Request('http://host/api/session.export?sessionId=session-root'),
    )
    const files = unzipSync(await responseBytes(response))
    expect(Object.keys(files)).toEqual(['session.jsonl'])
    expect(strFromU8(files['session.jsonl'] as Uint8Array)).toBe('')
  })

  it('exports a shared lineage node once (seen-set dedup)', async () => {
    const api = await buildApi({
      'session-root': artifact('session-root'),
      'child-a': artifact('child-a', sid('session-root')),
      'child-b': artifact('child-b', sid('session-root')),
      shared: artifact('shared', sid('child-a')),
    }, [
      node('child-a', node('shared')),
      node('child-b', node('shared')),
    ])
    const response = await toFetchHandler(api).fetch(
      new Request('http://host/api/session.export?sessionId=session-root&includeDescendants=true'),
    )
    const files = unzipSync(await responseBytes(response))
    expect(Object.keys(files).sort()).toEqual([
      'session.jsonl',
      'subagents/child-a/session.jsonl',
      'subagents/child-b/session.jsonl',
      'subagents/shared/session.jsonl',
    ])
  })

  it('answers 500 without leaking the backend error when the root artifact read fails', async () => {
    const api = await buildApi({}, [], { query: true, persistence: 'throw' })
    const response = await toFetchHandler(api).fetch(
      new Request('http://host/api/session.export?sessionId=session-root'),
    )
    expect(response.status).toBe(500)
    const body = await response.text()
    expect(body).toBe('session log export failed to prepare the stored artifact')
    expect(body).not.toContain('/host/private/')
  })

  it('answers the private-error-safe 500 when the live root flush fails', async () => {
    const api = await buildApi({ 'session-root': artifact('session-root') }, [], {
      sessions: {
        get: id => ({ id }),
        flush: async () => { throw new Error('/host/private/flush-state') },
      },
    })
    const response = await toFetchHandler(api).fetch(
      new Request('http://host/api/session.export?sessionId=session-root'),
    )
    expect(response.status).toBe(500)
    const body = await response.text()
    expect(body).toBe('session log export failed to prepare the stored artifact')
    expect(body).not.toContain('/host/private/')
  })

  it('forwards one request signal through root, lineage, and descendant reads', async () => {
    const reads: Array<{ id: SessionId; signal: AbortSignal | undefined }> = []
    const traces: AbortSignal[] = []
    const api = await buildApi({}, [node('child-a')], {
      readRaw: async (id, signal) => {
        reads.push({ id, signal })
        return id === sid('session-root')
          ? artifact('session-root')
          : artifact('child-a', sid('session-root'))
      },
      traceSession: async (_id, signal) => {
        if (signal !== undefined) traces.push(signal)
        return {
          target: { header: header('session-root'), live: false, persisted: true },
          ancestors: [],
          complete: true,
          root: { header: header('session-root'), live: false, persisted: true },
          descendants: [node('child-a')],
        }
      },
    })
    const controller = new AbortController()
    const response = await api.downloads.sessionLog(
      { sessionId: sid('session-root'), includeDescendants: true },
      controller.signal,
    )
    await response.arrayBuffer()
    const producerSignal = traces[0]
    if (producerSignal === undefined) throw new Error('missing lineage signal')
    expect(reads[0]).toEqual({ id: sid('session-root'), signal: controller.signal })
    expect(reads[1]).toEqual({ id: sid('child-a'), signal: producerSignal })
    const cancellation = new Error('request cancelled after response')
    controller.abort(cancellation)
    expect(producerSignal.aborted).toBe(true)
    expect(producerSignal.reason).toBe(cancellation)
  })

  it('preserves request cancellation instead of translating it to HTTP 500', async () => {
    const api = await buildApi({ 'session-root': artifact('session-root') })
    const controller = new AbortController()
    const cancellation = new Error('request cancelled')
    controller.abort(cancellation)
    await expect(api.downloads.sessionLog(
      { sessionId: sid('session-root'), includeDescendants: false },
      controller.signal,
    )).rejects.toBe(cancellation)
  })

  it('aborts descendant work and terminates ZIP production when its reader cancels', async () => {
    let reportDescendantStarted!: (signal: AbortSignal) => void
    const descendantStarted = new Promise<AbortSignal>((resolve) => {
      reportDescendantStarted = resolve
    })
    const api = await buildApi({}, [node('child-a')], {
      readRaw: async (id, signal) => {
        if (id === sid('session-root')) return artifact('session-root')
        if (signal === undefined) throw new Error('missing descendant signal')
        reportDescendantStarted(signal)
        return new Promise((_, reject) => {
          signal.addEventListener('abort', () => {
            reject(signal.reason as Error)
          }, { once: true })
        })
      },
    })
    const response = await api.downloads.sessionLog(
      { sessionId: sid('session-root'), includeDescendants: true },
      new AbortController().signal,
    )
    const reader = response.body?.getReader()
    if (reader === undefined) throw new Error('missing response body')
    const descendantSignal = await descendantStarted
    const cancellation = new Error('download consumer left')
    await reader.cancel(cancellation)
    expect(descendantSignal.aborted).toBe(true)
    expect(descendantSignal.reason).toBe(cancellation)
  })

  it('aborts attachment reads when its reader cancels', async () => {
    let reportAttachmentStarted!: (signal: AbortSignal) => void
    const attachmentStarted = new Promise<AbortSignal>((resolve) => {
      reportAttachmentStarted = resolve
    })
    const root = artifact('session-root', undefined, [
      '{"type":"session","version":0,"id":"session-root","createdAt":1000}',
      imageEventLine('slow-img'),
    ].join('\n') + '\n')
    const api = await buildApi({ 'session-root': root }, [], {
      attachments: async (_ref, signal) => {
        if (signal === undefined) throw new Error('missing attachment signal')
        reportAttachmentStarted(signal)
        return new Promise((_, reject) => {
          signal.addEventListener('abort', () => {
            reject(signal.reason as Error)
          }, { once: true })
        })
      },
    })
    const response = await api.downloads.sessionLog(
      { sessionId: sid('session-root'), includeDescendants: false },
      new AbortController().signal,
    )
    const reader = response.body?.getReader()
    if (reader === undefined) throw new Error('missing response body')
    const attachmentSignal = await attachmentStarted
    const cancellation = new Error('download consumer left during attachment read')
    await reader.cancel(cancellation)
    expect(attachmentSignal.aborted).toBe(true)
    expect(attachmentSignal.reason).toBe(cancellation)
  })

  it('uses a stable Error reason when its reader cancels without one', async () => {
    let reportDescendantStarted!: (signal: AbortSignal) => void
    const descendantStarted = new Promise<AbortSignal>((resolve) => {
      reportDescendantStarted = resolve
    })
    const api = await buildApi({}, [node('child-a')], {
      readRaw: async (id, signal) => {
        if (id === sid('session-root')) return artifact('session-root')
        if (signal === undefined) throw new Error('missing descendant signal')
        reportDescendantStarted(signal)
        return new Promise((_, reject) => {
          signal.addEventListener('abort', () => {
            reject(signal.reason as Error)
          }, { once: true })
        })
      },
    })
    const response = await api.downloads.sessionLog(
      { sessionId: sid('session-root'), includeDescendants: true },
      new AbortController().signal,
    )
    const reader = response.body?.getReader()
    if (reader === undefined) throw new Error('missing response body')
    const descendantSignal = await descendantStarted
    await reader.cancel()
    expect(descendantSignal.reason).toEqual(new Error('session log export stream cancelled'))
  })

  it('normalizes a non-Error descendant failure before erroring the stream', async () => {
    const api = await buildApi({}, [node('child-a')], {
      readRaw: async (id) => {
        if (id === sid('session-root')) return artifact('session-root')
        throw 'descendant read failed'
      },
    })
    const response = await api.downloads.sessionLog(
      { sessionId: sid('session-root'), includeDescendants: true },
      new AbortController().signal,
    )
    await expect(response.arrayBuffer()).rejects.toEqual(new Error('descendant read failed'))
  })

  it('includes media objects referenced by the root log under media/<id>.<ext>', async () => {
    const root = artifact('session-root', undefined, [
      '{"type":"session","version":0,"id":"session-root","createdAt":1000}',
      imageEventLine('img-1'),
    ].join('\n') + '\n')
    const api = await buildApi({ 'session-root': root })
    const response = await toFetchHandler(api).fetch(
      new Request('http://host/api/session.export?sessionId=session-root'),
    )
    expect(response.status).toBe(200)
    const files = unzipSync(await responseBytes(response))
    expect(Object.keys(files).sort()).toEqual(['media/img-1.png', 'session.jsonl'])
    expect(files['media/img-1.png']).toEqual(storedImage('img-1').data)
  })

  it('collects media referenced from nested tool results', async () => {
    const nested = '{"type":"assistant/message","seq":2,"time":2000,"data":{"content":[{"type":"tool-result","content":[{"type":"image","attachment":{"attachmentId":"nested-1","mediaType":"image/webp","bytes":4,"width":2,"height":2}}]}]}}'
    const root = artifact('session-root', undefined, [
      '{"type":"session","version":0,"id":"session-root","createdAt":1000}',
      nested,
    ].join('\n') + '\n')
    const api = await buildApi({ 'session-root': root })
    const response = await toFetchHandler(api).fetch(
      new Request('http://host/api/session.export?sessionId=session-root'),
    )
    const files = unzipSync(await responseBytes(response))
    expect(Object.keys(files).sort()).toEqual(['media/nested-1.webp', 'session.jsonl'])
  })

  it('scans the wrapped, inserted, and chunk carriers plus non-object content items', async () => {
    const block = (id: string, mediaType: string) =>
      `{"type":"image","attachment":{"attachmentId":"${id}","mediaType":"${mediaType}","bytes":4,"width":2,"height":2}}`
    const wrapped = `{"type":"assistant/message","seq":2,"time":2000,"data":{"message":{"role":"assistant","content":["noise",${block('wrapped-1', 'image/jpeg')}]}}}`
    const inserted = `{"type":"context/inserted","seq":3,"time":3000,"data":{"inserted":[{"content":[${block('inserted-1', 'image/gif')}]}]}}`
    const chunk = `{"type":"assistant/chunk","seq":4,"time":4000,"data":{"chunk":{"type":"block-end","block":${block('chunk-1', 'image/png')}}}}`
    const root = artifact('session-root', undefined, [
      '{"type":"session","version":0,"id":"session-root","createdAt":1000}',
      wrapped,
      inserted,
      chunk,
    ].join('\n') + '\n')
    const api = await buildApi({ 'session-root': root })
    const response = await toFetchHandler(api).fetch(
      new Request('http://host/api/session.export?sessionId=session-root'),
    )
    const files = unzipSync(await responseBytes(response))
    expect(Object.keys(files).sort()).toEqual([
      'media/chunk-1.png',
      'media/inserted-1.gif',
      'media/wrapped-1.jpg',
      'session.jsonl',
    ])
  })

  it('deduplicates one media object referenced by several included logs', async () => {
    const line = imageEventLine('shared-img')
    const root = artifact('session-root', undefined, [
      '{"type":"session","version":0,"id":"session-root","createdAt":1000}',
      line,
    ].join('\n') + '\n')
    const child = artifact('child-a', sid('session-root'), [
      '{"type":"session","version":0,"id":"child-a","createdAt":1000}',
      line,
    ].join('\n') + '\n')
    const api = await buildApi({ 'session-root': root, 'child-a': child }, [node('child-a')])
    const response = await toFetchHandler(api).fetch(
      new Request('http://host/api/session.export?sessionId=session-root&includeDescendants=true'),
    )
    const files = unzipSync(await responseBytes(response))
    expect(files['media/shared-img.png']).toEqual(storedImage('shared-img').data)
    expect(Object.keys(files).filter(name => name.startsWith('media/'))).toEqual(['media/shared-img.png'])
  })

  it('includes descendant media only when descendants are requested', async () => {
    const child = artifact('child-a', sid('session-root'), [
      '{"type":"session","version":0,"id":"child-a","createdAt":1000}',
      imageEventLine('child-img'),
    ].join('\n') + '\n')
    const api = await buildApi({ 'session-root': artifact('session-root'), 'child-a': child }, [node('child-a')])
    const without = await toFetchHandler(api).fetch(
      new Request('http://host/api/session.export?sessionId=session-root'),
    )
    expect(Object.keys(unzipSync(await responseBytes(without)))).toEqual(['session.jsonl'])
    const withDescendants = await toFetchHandler(api).fetch(
      new Request('http://host/api/session.export?sessionId=session-root&includeDescendants=true'),
    )
    expect(Object.keys(unzipSync(await responseBytes(withDescendants))).sort()).toEqual([
      'media/child-img.png',
      'session.jsonl',
      'subagents/child-a/session.jsonl',
    ])
  })

  it('fails the whole export when a referenced image cannot be read', async () => {
    const root = artifact('session-root', undefined, [
      '{"type":"session","version":0,"id":"session-root","createdAt":1000}',
      imageEventLine('gone-img'),
    ].join('\n') + '\n')
    const api = await buildApi({ 'session-root': root }, [], {
      attachments: async () => { throw new Error('attachment bytes missing') },
    })
    const response = await toFetchHandler(api).fetch(
      new Request('http://host/api/session.export?sessionId=session-root'),
    )
    expect(response.status).toBe(200)
    await expect(response.arrayBuffer()).rejects.toThrow('attachment bytes missing')
  })

  it('answers 500 when the deployment mounts no attachments service', async () => {
    const api = await buildApi({ 'session-root': artifact('session-root') }, [], { attachments: false })
    const response = await toFetchHandler(api).fetch(
      new Request('http://host/api/session.export?sessionId=session-root'),
    )
    expect(response.status).toBe(500)
    expect(await response.text()).toContain('attachments')
  })
})
