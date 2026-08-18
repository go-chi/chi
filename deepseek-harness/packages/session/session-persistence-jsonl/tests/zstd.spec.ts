import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { appendFile, mkdir, mkdtemp, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { logPath, scanLog, sessionDir, toHeaderLine, type JsonlCompression } from '../src/format.ts'
import {
  compressZstdFrame, createZstdFrameDecoder, decompressZstdFrame, decompressZstdPrefix, scanZstdFrames,
  type ZstdFrameDecoder,
} from '../src/zstd.ts'
import { NodePrivateZstdFrameDecoder } from '../src/zstd-private-decoder.ts'
import { PublicZstdFrameDecoder } from '../src/zstd-public-decoder.ts'
import { runPersistenceContract, meta, oneTurnLog } from '../../session-persistence/tests/contract.ts'
import { runCoordinatorContract, type CoordinatorFixture } from '../../session-persistence/tests/coordinator-contract.ts'

const MAGIC = Buffer.from([0x28, 0xB5, 0x2F, 0xFD])
const roots: string[] = []
const contexts: Context[] = []

interface ZstdReaderInternals {
  readZstdPrefix(buffer: Buffer, signal?: AbortSignal): Promise<{ events: SessionEvent[] }>
}

type HeaderRead = (
  this: FileHandle,
  buffer: Buffer,
  offset: number,
  length: number,
  position: number | null,
) => Promise<{ bytesRead: number; buffer: Buffer }>

async function freshRoot(prefix = 'dsh-jsonl-zstd-'): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

async function mount(root: string, compression?: JsonlCompression): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlSessionPersistence, {
    root,
    ...(compression === undefined ? {} : { compression }),
  })
  return ctx
}

async function decodeCompleteFrames(buffer: Buffer): Promise<Buffer> {
  const { frames, tornStart } = scanZstdFrames(buffer)
  expect(tornStart).toBeUndefined()
  const plaintext: Buffer[] = []
  for (const frame of frames) {
    plaintext.push(await decompressZstdFrame(buffer.subarray(frame.start, frame.end)))
  }
  return Buffer.concat(plaintext)
}

async function tornFrame(
  plaintext: string,
  accepts: (decoded: string) => boolean,
): Promise<Buffer> {
  const frame = await compressZstdFrame(plaintext)
  const candidateEnds = [
    frame.length - 1,
    frame.length - 4,
    ...[0.9, 0.75, 0.6, 0.5, 0.4, 0.25].map(ratio => Math.floor(frame.length * ratio)),
  ]
  for (const end of candidateEnds) {
    const candidate = frame.subarray(0, end)
    if (scanZstdFrames(candidate).tornStart !== 0) continue
    try {
      const decoded = (await decompressZstdPrefix(candidate)).toString('utf8')
      if (accepts(decoded)) return candidate
    } catch {
      // Some early cuts precede the first decodable block; keep searching for
      // a cut that exercises partial-plaintext recovery.
    }
  }
  throw new Error('test fixture could not produce the requested torn Zstandard frame')
}

function deterministicNoise(length: number): string {
  let state = 0x12345678
  let output = ''
  for (let index = 0; index < length; index++) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    output += String.fromCharCode(33 + (state % 90))
  }
  return output
}

function emptyStructuralFrame(descriptor: number): Buffer {
  const contentSizeFlag = descriptor >>> 6
  const singleSegment = (descriptor & 0x20) !== 0
  const dictionaryBytes = [0, 1, 2, 4][descriptor & 0x03]!
  const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
  const variableHeader = Buffer.alloc((singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes)
  const lastEmptyRawBlock = Buffer.from([1, 0, 0])
  const checksum = (descriptor & 0x04) === 0 ? Buffer.alloc(0) : Buffer.alloc(4)
  return Buffer.concat([MAGIC, Buffer.from([descriptor]), variableHeader, lastEmptyRawBlock, checksum])
}

afterEach(async () => {
  vi.restoreAllMocks()
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

runPersistenceContract('jsonl-zstd', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-jsonl-zstd-contract-'))
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const fiber = await ctx.plugin(JsonlSessionPersistence, { root })
  return {
    persistence: ctx.sessionPersistence,
    dispose: async () => {
      await fiber.dispose()
      await rm(root, { recursive: true, force: true })
    },
  }
})

runCoordinatorContract('jsonl-zstd', async (): Promise<CoordinatorFixture> => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-jsonl-zstd-coordinator-'))
  return {
    mount: async ctx => ctx.plugin(JsonlSessionPersistence, { root }),
    corruptTail: async (id, cwd) => {
      const line = JSON.stringify({
        type: 'assistant/chunk',
        seq: 8,
        time: 9,
        data: { turn: 2, step: 1, chunk: { type: 'text-delta', index: 0, text: deterministicNoise(300_000) } },
      }) + '\n'
      const partial = await tornFrame(line, decoded => decoded.length > 0 && !decoded.endsWith('\n'))
      await appendFile(logPath(root, cwd, id, 'zstd'), partial)
    },
    cleanup: async () => { await rm(root, { recursive: true, force: true }) },
  }
})

describe('Zstandard frame structure', () => {
  it('scans concatenated checksummed frames and honors a frame limit', async () => {
    const first = await compressZstdFrame('header\n')
    const second = await compressZstdFrame('event\n')
    const stream = Buffer.concat([first, second])
    expect(scanZstdFrames(Buffer.alloc(0))).toEqual({ frames: [] })
    expect(scanZstdFrames(stream)).toEqual({
      frames: [{ start: 0, end: first.length }, { start: first.length, end: stream.length }],
    })
    expect(scanZstdFrames(stream, 1)).toEqual({ frames: [{ start: 0, end: first.length }] })
    expect(first[4]! & 0x04).toBe(0x04)
    expect(second[4]! & 0x04).toBe(0x04)
    expect((await decompressZstdFrame(first)).toString()).toBe('header\n')
    const decoder = createZstdFrameDecoder()
    try {
      const plaintext = Array.from(decoder.decode(stream, scanZstdFrames(stream).frames), chunk => Buffer.from(chunk))
      expect(Buffer.concat(plaintext).toString()).toBe('header\nevent\n')
    } finally {
      decoder.close()
    }
  })

  it('keeps the public and Node-private synchronous decoders interchangeable', async () => {
    const frames = [await compressZstdFrame('first\n'), await compressZstdFrame('second\n')]
    const stream = Buffer.concat(frames)
    const ranges = scanZstdFrames(stream).frames
    const privateDecoder = NodePrivateZstdFrameDecoder.create()
    expect(privateDecoder).toBeDefined()

    for (const decoder of [new PublicZstdFrameDecoder(), privateDecoder!]) {
      try {
        const plaintext = Array.from(decoder.decode(stream, ranges), chunk => Buffer.from(chunk))
        expect(plaintext).toHaveLength(2)
        expect(Buffer.concat(plaintext).toString()).toBe('first\nsecond\n')
      } finally {
        decoder.close()
      }
    }
  })

  it('falls back to the public decoder when the private Node contract is unavailable', () => {
    vi.spyOn(NodePrivateZstdFrameDecoder, 'create').mockReturnValue(undefined)
    const decoder = createZstdFrameDecoder()
    expect(decoder).toBeInstanceOf(PublicZstdFrameDecoder)
    decoder.close()
  })

  it('enforces decoder lifecycle and checksum errors through both implementations', async () => {
    const frame = await compressZstdFrame('frame\n')
    const range = [{ start: 0, end: frame.length }]
    const corrupt = Buffer.from(frame)
    corrupt[corrupt.length - 1] = corrupt[corrupt.length - 1]! ^ 0xFF
    const factories: Array<() => ZstdFrameDecoder> = [
      () => new PublicZstdFrameDecoder(),
      () => NodePrivateZstdFrameDecoder.create()!,
    ]

    for (const create of factories) {
      const interrupted = create()
      const iterator = interrupted.decode(frame, range)
      expect(iterator.next().value?.toString()).toBe('frame\n')
      iterator.return()
      expect(() => Array.from(interrupted.decode(frame, range))).toThrow(/already started/)
      interrupted.close()

      const closed = create()
      closed.close()
      closed.close()
      expect(() => Array.from(closed.decode(frame, range))).toThrow(/closed/)

      const invalid = create()
      expect(() => Array.from(invalid.decode(corrupt, range))).toThrow(/frame at byte 0 failed validation/)
    }
  })

  it('assembles private-decoder output at and beyond its reusable chunk boundary', async () => {
    for (const length of [8, 9]) {
      const plaintext = Buffer.alloc(length, 0x61)
      const frame = await compressZstdFrame(plaintext)
      const decoder = NodePrivateZstdFrameDecoder.create()!
      ;(decoder as unknown as { output: Buffer }).output = Buffer.allocUnsafe(8)
      const [decoded] = Array.from(
        decoder.decode(frame, [{ start: 0, end: frame.length }]),
        chunk => Buffer.from(chunk),
      )
      expect(decoded).toEqual(plaintext)
    }
  })

  it('normalizes private decoder stream failures', async () => {
    interface PrivateDecoderInternals {
      stream: {
        [key: symbol]: unknown
        emit(event: string, error: Error): boolean
      }
      errorKey: symbol
    }
    const frame = await compressZstdFrame('frame\n')
    const range = [{ start: 0, end: frame.length }]

    const emitted = NodePrivateZstdFrameDecoder.create()!
    const emittedInternals = emitted as unknown as PrivateDecoderInternals
    const first = new Error('first emitted decoder failure')
    emittedInternals.stream.emit('error', first)
    emittedInternals.stream.emit('error', new Error('later emitted decoder failure'))
    try {
      Array.from(emitted.decode(frame, range))
      throw new Error('expected emitted decoder failure')
    } catch (error) {
      expect((error as Error).cause).toBe(first)
    }

    for (const internalFailure of [new Error('internal decoder failure'), 'not an Error']) {
      const decoder = NodePrivateZstdFrameDecoder.create()!
      const internals = decoder as unknown as PrivateDecoderInternals
      internals.stream[internals.errorKey] = internalFailure
      try {
        Array.from(decoder.decode(frame, range))
        throw new Error('expected internal decoder failure')
      } catch (error) {
        const cause = (error as Error).cause
        if (internalFailure instanceof Error) {
          expect(cause).toBe(internalFailure)
        } else {
          expect(cause).toMatchObject({ message: 'Zstandard decoder exposed a non-Error internal failure' })
        }
      }
    }
  })

  it('distinguishes incomplete frame regions from invalid complete structure', () => {
    expect(scanZstdFrames(MAGIC.subarray(0, 2))).toEqual({ frames: [], tornStart: 0 })
    expect(scanZstdFrames(MAGIC)).toEqual({ frames: [], tornStart: 0 })
    expect(() => scanZstdFrames(Buffer.alloc(4))).toThrow(/invalid frame magic/)
    expect(() => scanZstdFrames(Buffer.concat([MAGIC, Buffer.from([0x08])]))).toThrow(/reserved frame-header bit/)

    // Non-single-segment descriptor with no window descriptor.
    expect(scanZstdFrames(Buffer.concat([MAGIC, Buffer.from([0x00])]))).toEqual({ frames: [], tornStart: 0 })
    // Single-segment header followed by only two bytes of the three-byte block header.
    expect(scanZstdFrames(Buffer.concat([MAGIC, Buffer.from([0x20, 0x00, 0x01, 0x00])]))).toEqual({
      frames: [],
      tornStart: 0,
    })

    const rawFiveBytes = Buffer.from([(5 << 3) | 1, 0, 0])
    expect(scanZstdFrames(Buffer.concat([
      MAGIC,
      Buffer.from([0x20, 0x00]),
      rawFiveBytes,
      Buffer.from([0x01, 0x02]),
    ]))).toEqual({ frames: [], tornStart: 0 })

    const reservedBlock = Buffer.concat([
      MAGIC,
      Buffer.from([0x20, 0x00, 0x07, 0x00, 0x00]),
    ])
    expect(() => scanZstdFrames(reservedBlock)).toThrow(/reserved block type/)
  })

  it('covers standard header variants, RLE blocks, multiple blocks, and checksums', () => {
    for (const descriptor of [0x00, 0x21, 0x42, 0x83, 0xE3]) {
      const frame = emptyStructuralFrame(descriptor)
      expect(scanZstdFrames(frame)).toEqual({ frames: [{ start: 0, end: frame.length }] })
    }

    const rle = Buffer.concat([
      MAGIC,
      Buffer.from([0x20, 0x01]),
      Buffer.from([(1 << 3) | (1 << 1) | 1, 0, 0]),
      Buffer.from([0x41]),
    ])
    expect(scanZstdFrames(rle)).toEqual({ frames: [{ start: 0, end: rle.length }] })

    const twoBlocks = Buffer.concat([
      MAGIC,
      Buffer.from([0x20, 0x00]),
      Buffer.from([0, 0, 0]),
      Buffer.from([1, 0, 0]),
    ])
    expect(scanZstdFrames(twoBlocks)).toEqual({ frames: [{ start: 0, end: twoBlocks.length }] })

    const checksummed = emptyStructuralFrame(0x24)
    expect(scanZstdFrames(checksummed.subarray(0, -1))).toEqual({ frames: [], tornStart: 0 })
    expect(scanZstdFrames(checksummed)).toEqual({ frames: [{ start: 0, end: checksummed.length }] })
  })
})

describe('JsonlSessionPersistence: default Zstandard encoding', () => {
  it('writes .jsonl.zstd by default with one header frame and one first-batch frame', async () => {
    const root = await freshRoot()
    const ctx = await mount(root)
    const header = meta('default-zstd', '/work')
    await ctx.sessionPersistence.create(header)
    await ctx.sessionPersistence.append(header.id, oneTurnLog())

    const path = logPath(root, header.cwd, header.id, 'zstd')
    const buffer = await readFile(path)
    expect(buffer.subarray(0, 4)).toEqual(MAGIC)
    await expect(stat(logPath(root, header.cwd, header.id, 'none'))).rejects.toThrow()
    expect(ctx.sessionPersistence.locate(header)).toEqual({ kind: 'jsonl', path })

    const scan = scanZstdFrames(buffer)
    expect(scan.frames).toHaveLength(2)
    const plaintext = await decodeCompleteFrames(buffer)
    expect(plaintext.toString()).toBe([
      JSON.stringify(toHeaderLine(header)),
      ...oneTurnLog().map(e => JSON.stringify(e)),
      '',
    ].join('\n'))
    expect((await ctx.sessionPersistence.load(header.id)).events).toEqual(oneTurnLog())
  })

  it('readRaw decodes the compressed artifact back to the original JSONL text', async () => {
    const root = await freshRoot()
    const ctx = await mount(root)
    const header = meta('raw-read-zstd', '/work')
    await ctx.sessionPersistence.create(header)
    await ctx.sessionPersistence.append(header.id, oneTurnLog())

    const raw = await ctx.sessionPersistence.readRaw(header.id)
    expect(raw).toBeDefined()
    // The logical name drops the physical encoding suffix.
    expect(raw!.filename).toBe('session.jsonl')
    expect(raw!.meta.id).toBe(header.id)
    expect(raw!.content).toBe([
      JSON.stringify(toHeaderLine(header)),
      ...oneTurnLog().map(e => JSON.stringify(e)),
      '',
    ].join('\n'))
    const scanned = scanLog(Buffer.from(raw!.content))
    expect(scanned.events.map(event => event.type)).toEqual(oneTurnLog().map(event => event.type))
  })

  it('readRaw rejects a present zstd artifact that carries no frame', async () => {
    const root = await freshRoot()
    const ctx = await mount(root)
    const header = meta('raw-zero-frame', '/work')
    await ctx.sessionPersistence.create(header)
    await ctx.sessionPersistence.append(header.id, oneTurnLog())
    // The path still exists, so zero frames is corruption rather than absence.
    await writeFile(logPath(root, '/work', header.id, 'zstd'), Buffer.alloc(0))
    await expect(ctx.sessionPersistence.readRaw(header.id))
      .rejects.toThrow('empty or header-less Zstandard session log')
  })

  it('resolves the default when a programmatic wrapper bypasses Loader schema normalization', async () => {
    const root = await freshRoot()
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SessionStore)
    let backend!: JsonlSessionPersistence
    await ctx.plugin(Object.assign((inner: Context) => {
      backend = new JsonlSessionPersistence(inner, { root })
    }, { inject: ['sessions'] }))
    const header = meta('direct-default')
    const path = logPath(root, header.cwd, header.id, 'zstd')
    expect(backend.locate(header)).toEqual({
      kind: 'jsonl',
      path,
    })

    const base = oneTurnLog()
    const events: SessionEvent[] = [
      ...base.slice(0, 3),
      ...Array.from({ length: 3 }, (_, index): SessionEvent => ({
        type: 'assistant/chunk',
        seq: 3 + index,
        time: 4 + index,
        data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: `part-${index}` } },
      })),
      ...base.slice(3).map((event): SessionEvent => ({
        ...event,
        seq: event.seq + 3,
        time: event.time + 3,
      })),
    ]
    await backend.create(header)
    await backend.append(header.id, events)

    const plaintext = (await decodeCompleteFrames(await readFile(path))).toString()
    const recordTypes = plaintext.trimEnd().split('\n')
      .map(line => (JSON.parse(line) as { type: string }).type)
    expect(recordTypes).toContain('text-chunks')
    expect((await backend.load(header.id)).events).toEqual(events)
  })

  it('appends one frame per durable batch without rewriting prior bytes', async () => {
    const root = await freshRoot()
    const ctx = await mount(root)
    const header = meta('append-frame')
    await ctx.sessionPersistence.create(header)
    await ctx.sessionPersistence.append(header.id, oneTurnLog())
    const path = logPath(root, header.cwd, header.id, 'zstd')
    const before = await readFile(path)
    const secondTurn = [
      { type: 'turn/start', seq: 6, time: 7, data: { turn: 2 } },
      { type: 'turn/end', seq: 7, time: 8, data: { turn: 2, reason: { kind: 'completed' } } },
    ] as SessionEvent[]
    await ctx.sessionPersistence.append(header.id, secondTurn)

    const after = await readFile(path)
    expect(after.subarray(0, before.length)).toEqual(before)
    expect(scanZstdFrames(after).frames).toHaveLength(3)
    expect((await ctx.sessionPersistence.load(header.id)).events).toEqual([...oneTurnLog(), ...secondTurn])
  })

  it('lists from a multi-chunk header frame without decoding a corrupt event frame', async () => {
    const root = await freshRoot()
    const ctx = await mount(root)
    const header = meta('large-header', `/work/${'x'.repeat(24_000)}`)
    await ctx.sessionPersistence.create(header)
    await ctx.sessionPersistence.append(header.id, oneTurnLog())
    const path = logPath(root, header.cwd, header.id, 'zstd')
    const buffer = Buffer.from(await readFile(path))
    const eventFrame = scanZstdFrames(buffer).frames[1]!
    buffer[eventFrame.end - 1] = buffer[eventFrame.end - 1]! ^ 0xFF
    await writeFile(path, buffer)

    expect((await ctx.sessionPersistence.list()).map(item => item.id)).toEqual([header.id])
    await expect(ctx.sessionPersistence.load(header.id)).rejects.toThrow(/frame at byte .* failed validation/)
  })

  it('stops multi-frame inspection when cancellation arrives at a slice deadline', async () => {
    const root = await freshRoot()
    const ctx = await mount(root)
    const header = meta('cancel-zstd-frames')
    const headerFrame = await compressZstdFrame(`${JSON.stringify(toHeaderLine(header))}\n`)
    const eventFrame = await compressZstdFrame(`${JSON.stringify(oneTurnLog()[0])}\n`)
    const laterFrame = await compressZstdFrame(`${JSON.stringify(oneTurnLog()[1])}\n`)
    const stream = Buffer.concat([headerFrame, eventFrame, laterFrame])
    const controller = new AbortController()
    const reason = new Error('cancel after Zstandard decode starts')
    const reader = ctx.sessionPersistence as unknown as ZstdReaderInternals
    vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValue(501)
    const pending = reader.readZstdPrefix(stream, controller.signal)
    queueMicrotask(() => { controller.abort(reason) })

    await expect(pending).rejects.toBe(reason)
  })

  it('continues decoding every frame after a slice deadline yields', async () => {
    const root = await freshRoot()
    const ctx = await mount(root)
    const header = meta('yield-zstd-frames')
    const events = oneTurnLog().slice(0, 2)
    const headerFrame = await compressZstdFrame(`${JSON.stringify(toHeaderLine(header))}\n`)
    const eventFrames = await Promise.all(events.map(async event => (
      compressZstdFrame(`${JSON.stringify(event)}\n`)
    )))
    const stream = Buffer.concat([headerFrame, ...eventFrames])
    const reader = ctx.sessionPersistence as unknown as ZstdReaderInternals
    vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValue(501)

    const prefix = await reader.readZstdPrefix(stream)

    expect(prefix.events).toEqual(events)
  })

  it.each(['none', 'zstd'] as const)(
    'observes cancellation after each async %s header read during listing',
    async (compression) => {
      const root = await freshRoot()
      const ctx = await mount(root, compression)
      const header = meta(`cancel-${compression}-header-read`, '/work')
      await ctx.sessionPersistence.create(header)
      await ctx.sessionPersistence.append(header.id, oneTurnLog())
      await ctx.sessionPersistence.list()
      const path = logPath(root, header.cwd, header.id, compression)
      const probe = await open(path, 'r')
      const prototype = Object.getPrototypeOf(probe) as { read: HeaderRead }
      const originalRead = prototype.read
      await probe.close()
      const controller = new AbortController()
      const reason = new Error(`cancel ${compression} header read`)
      const read = vi.spyOn(prototype, 'read').mockImplementation(async function (
        this: FileHandle,
        buffer: Buffer,
        offset: number,
        length: number,
        position: number | null,
      ) {
        const result = await originalRead.call(this, buffer, offset, length, position)
        controller.abort(reason)
        return result
      })

      await expect(ctx.sessionPersistence.list(controller.signal)).rejects.toBe(reason)
      expect(read).toHaveBeenCalledTimes(1)
    },
  )

  it('preserves complete records from a torn frame and re-encodes them with crash closers', async () => {
    const root = await freshRoot()
    const ctx = await mount(root)
    const header = meta('recover-torn', '/proj')
    await ctx.sessionPersistence.create(header)
    await ctx.sessionPersistence.append(header.id, oneTurnLog())
    const path = logPath(root, header.cwd, header.id, 'zstd')
    const committed = await readFile(path)
    const openTurn = [
      { type: 'turn/start', seq: 6, time: 7, data: { turn: 2 } },
      { type: 'step/start', seq: 7, time: 8, data: { turn: 2, step: 1 } },
      { type: 'assistant/chunk', seq: 8, time: 9, data: { turn: 2, step: 1, chunk: { type: 'text-delta', index: 0, text: deterministicNoise(300_000) } } },
    ] as SessionEvent[]
    const plaintext = openTurn.map(e => JSON.stringify(e)).join('\n') + '\n'
    const partial = await tornFrame(plaintext, (decoded) => {
      const newlines = decoded.match(/\n/g)?.length ?? 0
      return newlines >= 2 && !decoded.endsWith('\n')
    })
    await appendFile(path, partial)

    const loaded = await ctx.sessionPersistence.load(header.id)
    expect(loaded.events.map(event => event.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(loaded.events[6]).toEqual(openTurn[0])
    expect(loaded.events[7]).toEqual(openTurn[1])
    expect(loaded.events.some(event => event.type === 'assistant/chunk' && event.seq === 8)).toBe(false)
    expect(loaded.events[8]?.type).toBe('step/end')
    expect(loaded.events[9]?.type).toBe('turn/end')

    const repaired = await readFile(path)
    expect(repaired.subarray(0, committed.length)).toEqual(committed)
    expect(scanZstdFrames(repaired).tornStart).toBeUndefined()
    expect(scanLog(await decodeCompleteFrames(repaired)).events).toEqual(loaded.events)
  })

  it('drops a frame torn in its header before it has produced plaintext', async () => {
    const root = await freshRoot()
    const ctx = await mount(root)
    const header = meta('partial-magic')
    await ctx.sessionPersistence.create(header)
    await ctx.sessionPersistence.append(header.id, oneTurnLog())
    const path = logPath(root, header.cwd, header.id, 'zstd')
    const committed = await readFile(path)
    await appendFile(path, MAGIC.subarray(0, 2))

    expect((await ctx.sessionPersistence.load(header.id)).events).toEqual(oneTurnLog())
    expect(await readFile(path)).toEqual(committed)
  })

  it('recovers complete events when EOF tears only the final frame checksum', async () => {
    const root = await freshRoot()
    const ctx = await mount(root)
    const header = meta('partial-checksum')
    await ctx.sessionPersistence.create(header)
    await ctx.sessionPersistence.append(header.id, oneTurnLog())
    const path = logPath(root, header.cwd, header.id, 'zstd')
    const secondTurn = [
      { type: 'turn/start', seq: 6, time: 7, data: { turn: 2 } },
      { type: 'turn/end', seq: 7, time: 8, data: { turn: 2, reason: { kind: 'completed' } } },
    ] as SessionEvent[]
    const frame = await compressZstdFrame(secondTurn.map(e => JSON.stringify(e)).join('\n') + '\n')
    await appendFile(path, frame.subarray(0, -1))

    const loaded = await ctx.sessionPersistence.load(header.id)
    expect(loaded.events).toEqual([...oneTurnLog(), ...secondTurn])
    const repaired = await readFile(path)
    expect(scanZstdFrames(repaired).tornStart).toBeUndefined()
    expect(scanLog(await decodeCompleteFrames(repaired)).events).toEqual(loaded.events)
  })

  it('rejects a complete frame containing a torn JSONL record', async () => {
    const root = await freshRoot()
    const ctx = await mount(root)
    const header = meta('complete-bad-jsonl')
    await ctx.sessionPersistence.create(header)
    await ctx.sessionPersistence.append(header.id, oneTurnLog())
    await appendFile(
      logPath(root, header.cwd, header.id, 'zstd'),
      await compressZstdFrame('{"type":"turn/start"'),
    )
    await expect(ctx.sessionPersistence.load(header.id)).rejects.toThrow(/complete frame contains a torn JSONL record/)
  })

  it('rolls back a checksummed append frame when fsync fails', async () => {
    const root = await freshRoot()
    const ctx = await mount(root)
    const header = meta('zstd-fsync-rollback')
    await ctx.sessionPersistence.create(header)
    await ctx.sessionPersistence.append(header.id, oneTurnLog())
    const path = logPath(root, header.cwd, header.id, 'zstd')
    const before = await readFile(path)

    const handle = await open(path, 'r')
    const prototype = Object.getPrototypeOf(handle) as { sync: () => Promise<void> }
    await handle.close()
    const realSync = prototype.sync
    let failed = false
    const spy = vi.spyOn(prototype, 'sync').mockImplementation(async function (this: FileHandle) {
      if (!failed) {
        failed = true
        throw new Error('simulated Zstandard fsync failure')
      }
      return realSync.call(this)
    })
    const secondTurn = [
      { type: 'turn/start', seq: 6, time: 7, data: { turn: 2 } },
      { type: 'turn/end', seq: 7, time: 8, data: { turn: 2, reason: { kind: 'completed' } } },
    ] as SessionEvent[]
    await expect(ctx.sessionPersistence.append(header.id, secondTurn)).rejects.toThrow(/simulated Zstandard fsync failure/)
    expect(await readFile(path)).toEqual(before)
    spy.mockRestore()
    await ctx.sessionPersistence.append(header.id, secondTurn)
    expect((await ctx.sessionPersistence.load(header.id)).events).toEqual([...oneTurnLog(), ...secondTurn])
  })

  it('skips empty, incomplete, and non-header compressed artifacts while rejecting malformed header frames', async () => {
    const root = await freshRoot()
    for (const [id, content] of [
      ['empty', Buffer.alloc(0)],
      ['partial', MAGIC],
      ['not-header', await compressZstdFrame('{"type":"turn/start"}\n')],
    ] as const) {
      const sessionId = SessionId(id)
      await mkdir(sessionDir(root, undefined, sessionId), { recursive: true })
      await writeFile(logPath(root, undefined, sessionId, 'zstd'), content)
    }
    const ctx = await mount(root)
    expect(await ctx.sessionPersistence.list()).toEqual([])

    const twoLinesId = SessionId('two-lines')
    await mkdir(sessionDir(root, undefined, twoLinesId), { recursive: true })
    await writeFile(logPath(root, undefined, twoLinesId, 'zstd'), await compressZstdFrame([
      JSON.stringify(toHeaderLine(meta('two-lines'))),
      JSON.stringify({ type: 'turn/start' }),
      '',
    ].join('\n')))
    await expect(ctx.sessionPersistence.list()).rejects.toThrow(/first frame is not exactly one header line/)
    await expect(ctx.sessionPersistence.load(SessionId('two-lines')))
      .rejects.toThrow(/first frame is not exactly one header line/)
  })

  it('rejects missing, empty, and checksum-corrupt header frames on targeted reads', async () => {
    const root = await freshRoot()
    for (const id of ['partial-only', 'empty-header', 'bad-checksum']) {
      await mkdir(sessionDir(root, undefined, SessionId(id)), { recursive: true })
    }
    await writeFile(logPath(root, undefined, SessionId('partial-only'), 'zstd'), MAGIC)
    await writeFile(logPath(root, undefined, SessionId('empty-header'), 'zstd'), await compressZstdFrame(''))
    const corruptHeader = Buffer.from(await compressZstdFrame(`${JSON.stringify(toHeaderLine(meta('bad-checksum')))}\n`))
    corruptHeader[corruptHeader.length - 1] = corruptHeader[corruptHeader.length - 1]! ^ 0xFF
    await writeFile(logPath(root, undefined, SessionId('bad-checksum'), 'zstd'), corruptHeader)
    const ctx = await mount(root)

    await expect(ctx.sessionPersistence.load(SessionId('partial-only')))
      .rejects.toThrow(/empty or header-less Zstandard session log/)
    await expect(ctx.sessionPersistence.load(SessionId('empty-header')))
      .rejects.toThrow(/first frame is not exactly one header line/)
    await expect(ctx.sessionPersistence.list()).rejects.toThrow(/header frame failed validation/)
  })
})

describe('JsonlSessionPersistence: encoding selection', () => {
  it('rejects roots owned by the opposite encoding in both directions', async () => {
    const rawRoot = await freshRoot('dsh-jsonl-raw-mismatch-')
    const raw = await mount(rawRoot, 'none')
    const rawHeader = meta('raw-log')
    await raw.sessionPersistence.create(rawHeader)
    await raw.sessionPersistence.append(rawHeader.id, oneTurnLog())
    const defaultBackend = await mount(rawRoot)
    await expect(defaultBackend.sessionPersistence.list()).rejects.toThrow(/configured for compression "zstd"/)

    const zstdRoot = await freshRoot('dsh-jsonl-zstd-mismatch-')
    const zstd = await mount(zstdRoot)
    const zstdHeader = meta('zstd-log')
    await zstd.sessionPersistence.create(zstdHeader)
    await zstd.sessionPersistence.append(zstdHeader.id, oneTurnLog())
    const rawBackend = await mount(zstdRoot, 'none')
    await expect(rawBackend.sessionPersistence.list()).rejects.toThrow(/configured for compression "none"/)
  })

  it('rechecks targeted artifacts and listing after an initially empty root', async () => {
    const root = await freshRoot()
    const ctx = await mount(root)
    expect(await ctx.sessionPersistence.list()).toEqual([])

    const loadHeader = meta('late-raw-load', '/late')
    await mkdir(sessionDir(root, loadHeader.cwd, loadHeader.id), { recursive: true })
    await writeFile(logPath(root, loadHeader.cwd, loadHeader.id, 'none'), [
      JSON.stringify(toHeaderLine(loadHeader)),
      ...oneTurnLog().map(e => JSON.stringify(e)),
      '',
    ].join('\n'))
    await expect(ctx.sessionPersistence.load(loadHeader.id)).rejects.toThrow(/uses \.jsonl/)
    await expect((ctx.sessionPersistence as JsonlSessionPersistence).loadStored(loadHeader.id))
      .rejects.toThrow(/uses \.jsonl/)
    await expect(ctx.sessionPersistence.list()).rejects.toThrow(/uses \.jsonl/)
  })

  it('refuses materialization when an opposite artifact appears after create', async () => {
    const root = await freshRoot()
    const ctx = await mount(root)
    await ctx.sessionPersistence.list()
    const header = meta('late-raw-materialize', '/late')
    await ctx.sessionPersistence.create(header)
    await mkdir(sessionDir(root, header.cwd, header.id), { recursive: true })
    await writeFile(logPath(root, header.cwd, header.id, 'none'), [
      JSON.stringify(toHeaderLine(header)),
      ...oneTurnLog().map(e => JSON.stringify(e)),
      '',
    ].join('\n'))
    await expect(ctx.sessionPersistence.append(header.id, oneTurnLog())).rejects.toThrow(/uses \.jsonl/)
    expect((await readdir(sessionDir(root, header.cwd, header.id))).some(name => name.endsWith('.jsonl.zstd'))).toBe(false)
  })
})
