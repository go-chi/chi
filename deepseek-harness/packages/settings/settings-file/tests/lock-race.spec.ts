// A temp-file write failure cannot be timed from outside. The `fs/promises` API
// injects it once so the test can prove that the writer lock still releases.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { FileSettingsProvider } from '../src/index.ts'

const state = vi.hoisted(() => ({
  failTempWrite: false,
  failDocumentCreate: false,
  holdDocumentCreate: false,
  documentCreateStarted: undefined as (() => void) | undefined,
  continueDocumentCreate: undefined as Promise<void> | undefined,
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    writeFile: (async (path: unknown, ...rest: never[]) => {
      if (state.holdDocumentCreate && String(path).endsWith('settings.yaml')) {
        state.holdDocumentCreate = false
        state.documentCreateStarted!()
        await state.continueDocumentCreate!
      }
      if (state.failDocumentCreate && String(path).endsWith('settings.yaml')) {
        state.failDocumentCreate = false
        throw Object.assign(new Error('ENOSPC: injected document create failure'), { code: 'ENOSPC' })
      }
      if (state.failTempWrite && String(path).endsWith('.tmp')) {
        state.failTempWrite = false
        throw Object.assign(new Error('ENOSPC: injected writeFile failure'), { code: 'ENOSPC' })
      }
      return (actual.writeFile as (path: unknown, ...args: never[]) => Promise<void>)(path, ...rest)
    }) as typeof actual.writeFile,
  }
})

const AlphaSchema: z<{ value: number }> = z.object({ value: z.number().default(0) })

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  state.failTempWrite = false
  state.failDocumentCreate = false
  state.holdDocumentCreate = false
  state.documentCreateStarted = undefined
  state.continueDocumentCreate = undefined
  while (cleanups.length > 0) await cleanups.pop()!()
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-settings-lockrace-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

async function boot(config: ConstructorParameters<typeof FileSettingsProvider>[1]): Promise<Context> {
  const ctx = new Context()
  const fiber = ctx.plugin(FileSettingsProvider, config)
  cleanups.push(async () => { await fiber.dispose() })
  await fiber
  return ctx
}

describe('writer-lock failure cleanup', () => {
  it('skips publication when an in-flight document create completes during teardown', async () => {
    const dir = await tempDir()
    const path = join(dir, 'settings.yaml')
    const ctx = new Context()
    const fiber = ctx.plugin(FileSettingsProvider, { path, watch: false })
    cleanups.push(async () => { await fiber.dispose() })
    await fiber
    const settings = ctx.settings
    settings.register(settingsNamespace('alpha'), AlphaSchema)
    const published: number[] = []
    ctx.on('settings/document-updated', (_ns, revision) => { published.push(revision) })
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    let releaseCreate!: () => void
    state.continueDocumentCreate = new Promise<void>((resolve) => { releaseCreate = resolve })
    state.documentCreateStarted = markStarted
    state.holdDocumentCreate = true

    const preparing = settings.prepareDocument()
    await started
    let disposed = false
    const disposing = fiber.dispose()
    void disposing.then(() => { disposed = true })
    await vi.waitFor(() => {
      expect((settings as unknown as { closed: boolean }).closed).toBe(true)
    })
    expect(disposed).toBe(false)
    releaseCreate()
    await expect(preparing).resolves.toBe(path)
    await disposing
    expect(await readFile(path, 'utf8')).toBe('')
    expect(published).toEqual([])
  })

  it('surfaces an exclusive document-create failure and releases the lock', async () => {
    const dir = await tempDir()
    const path = join(dir, 'settings.yaml')
    const ctx = await boot({ path, watch: false })
    state.failDocumentCreate = true
    await expect(ctx.settings.prepareDocument()).rejects.toThrow(/ENOSPC/)
    await expect(access(`${path}.lock`)).rejects.toThrow()
  })

  it('cleans up the temp file and releases the lock when the write fails mid-cycle', async () => {
    const dir = await tempDir()
    const path = join(dir, 'settings.yaml')
    await writeFile(path, 'alpha:\n  value: 1\n')
    const ctx = await boot({ path, watch: false })
    const scope = ctx.settings.register(settingsNamespace('alpha'), AlphaSchema)
    state.failTempWrite = true
    await expect(scope.update({ value: 9 })).rejects.toThrow(/ENOSPC/)
    // The document is untouched and the writer lock was released on the way out.
    expect(await readFile(path, 'utf8')).toContain('value: 1')
    await expect(access(`${path}.lock`)).rejects.toThrow()
  })
})
