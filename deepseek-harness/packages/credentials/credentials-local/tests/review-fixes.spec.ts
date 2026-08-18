// Third-review behaviors: read-modify-write under the writer lock (external
// edits survive an API write), the contained credentials/updated fan-out (a
// broken observer never fails a committed write), and the YAML document
// editor's isolation between entries.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { LocalCredentialProvider } from '../src/index.ts'

/** Credential documents are seeded owner-only, exactly as the provider creates them. */
function writeCredentials(file: string, text: string): Promise<void> {
  return writeFile(file, text, { mode: 0o600 })
}

const ALPHA = credentialRef('DSH_REVIEW_ALPHA')
const BETA = credentialRef('DSH_REVIEW_BETA')
const INNER = credentialRef('DSH_REVIEW_INNER')

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-cred-review-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

async function boot(config: ConstructorParameters<typeof LocalCredentialProvider>[1]): Promise<Context> {
  const ctx = new Context()
  const fiber = ctx.plugin(LocalCredentialProvider, config)
  cleanups.push(async () => { await fiber.dispose() })
  await fiber
  return ctx
}

describe('read-modify-write', () => {
  it('folds an unobserved external edit into a write instead of overwriting it', async () => {
    const dir = await tempDir()
    const path = join(dir, '.credentials.yaml')
    const ctx = await boot({ path, watch: false })
    const seen: string[] = []
    ctx.on('credentials/updated', (ref) => { seen.push(ref) })
    await ctx.credentials.set(ALPHA, 'one')
    // The external edit has landed on disk but no watcher reported it (watch
    // is off — the same blind spot as a debounce window or a missed event).
    await writeCredentials(path, `${ALPHA}: one\n${BETA}: external\n`)
    await ctx.credentials.set(ALPHA, 'two')
    const text = await readFile(path, 'utf8')
    expect(text).toContain(`${BETA}: external`)
    expect(text).toContain(`${ALPHA}: two`)
    // The fold published the unobserved entry before the write's own commit.
    expect(seen).toEqual([ALPHA, BETA, ALPHA])
    expect(await ctx.credentials.resolve(BETA)).toEqual({ value: 'external', source: 'file' })
  })

  it('keeps both refs when two providers write the same document concurrently', async () => {
    const dir = await tempDir()
    const path = join(dir, '.credentials.yaml')
    const first = await boot({ path, watch: false })
    const second = await boot({ path, watch: false })
    await Promise.all([
      (async () => { for (const value of ['1', '2', '3'] as const) await first.credentials.set(ALPHA, value) })(),
      (async () => { for (const value of ['1', '2', '3'] as const) await second.credentials.set(BETA, value) })(),
    ])
    const third = await boot({ path, watch: false })
    expect(await third.credentials.resolve(ALPHA)).toEqual({ value: '3', source: 'file' })
    expect(await third.credentials.resolve(BETA)).toEqual({ value: '3', source: 'file' })
  })

  it('creates the credentials directory owner-only', async () => {
    const dir = await tempDir()
    const home = join(dir, 'home')
    const ctx = await boot({ path: join(home, '.credentials.yaml'), watch: false })
    await ctx.credentials.set(ALPHA, 'one')
    if (process.platform !== 'win32') expect((await stat(home)).mode & 0o777).toBe(0o700)
  })
})

describe('contained update fan-out', () => {
  it('does not fail a committed set when a listener throws, and later listeners still run', async () => {
    const dir = await tempDir()
    const ctx = await boot({ path: join(dir, '.credentials.yaml'), watch: false })
    ctx.on('credentials/updated', () => {
      throw new Error('observer boom')
    })
    const second = vi.fn()
    ctx.on('credentials/updated', second)
    await expect(ctx.credentials.set(ALPHA, 'one')).resolves.toBeUndefined()
    expect(second).toHaveBeenCalledWith(ALPHA)
    expect(await ctx.credentials.resolve(ALPHA)).toEqual({ value: 'one', source: 'file' })
  })

  it('contains an async listener rejection', async () => {
    const dir = await tempDir()
    const ctx = await boot({ path: join(dir, '.credentials.yaml'), watch: false })
    // An unknown-returning function keeps the typed surface legal while the
    // runtime value is still the rejected promise the containment must handle.
    const boom = (): unknown => Promise.reject(new Error('async observer boom'))
    ctx.on('credentials/updated', boom)
    await expect(ctx.credentials.set(ALPHA, 'one')).resolves.toBeUndefined()
    await new Promise(resolve => setTimeout(resolve, 10))
  })

  it('rethrows an invariant-coded failure after the commit and the remaining listeners', async () => {
    const dir = await tempDir()
    const path = join(dir, '.credentials.yaml')
    const ctx = await boot({ path, watch: false })
    ctx.on('credentials/updated', () => {
      throw Object.assign(new Error('forged relation'), { code: 'INVARIANT' })
    })
    const second = vi.fn()
    ctx.on('credentials/updated', second)
    await expect(ctx.credentials.set(ALPHA, 'one')).rejects.toThrow(/forged relation/)
    // Harness-fatal by design — but the write itself committed first.
    expect(second).toHaveBeenCalledWith(ALPHA)
    expect(await readFile(path, 'utf8')).toContain(`${ALPHA}: one`)
    expect(await ctx.credentials.resolve(ALPHA)).toEqual({ value: 'one', source: 'file' })
  })
})

describe('document editor', () => {
  it('leaves a sibling multi-line value untouched while patching one entry', async () => {
    const dir = await tempDir()
    const path = join(dir, '.credentials.yaml')
    const wrapped = `DSH_REVIEW_WRAPPED: |-\n  line1\n  line2\n${ALPHA}: a\n`
    await writeCredentials(path, wrapped)
    const ctx = await boot({ path, watch: false })
    await ctx.credentials.set(ALPHA, 'b')
    expect(await readFile(path, 'utf8')).toBe(`DSH_REVIEW_WRAPPED: |-\n  line1\n  line2\n${ALPHA}: b\n`)
    expect(await ctx.credentials.resolve(credentialRef('DSH_REVIEW_WRAPPED')))
      .toEqual({ value: 'line1\nline2', source: 'file' })
  })

  it('stores a value that looks like another entry without creating one', async () => {
    const dir = await tempDir()
    const path = join(dir, '.credentials.yaml')
    const ctx = await boot({ path, watch: false })
    // The stored text must stay a value: a quoted-scalar write that leaked its
    // own structure would silently mint a credential nobody stored.
    await ctx.credentials.set(ALPHA, `${INNER}: injected`)
    const reread = await boot({ path, watch: false })
    expect(await reread.credentials.resolve(ALPHA)).toEqual({ value: `${INNER}: injected`, source: 'file' })
    expect(await reread.credentials.resolve(INNER)).toBeUndefined()
  })
})
