import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { FileSettingsProvider, resolveSpec } from '../src/index.ts'

interface ThemeConfig {
  theme: 'dark' | 'light'
  fontSize: number
}

const ThemeSchema: z<ThemeConfig> = z.object({
  theme: z.union(['dark', 'light']).default('dark'),
  fontSize: z.number().default(14),
})

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-settings-local-'))
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

describe('resolveSpec', () => {
  it('defaults watch and debounce when construction bypasses schema normalization', () => {
    const spec = resolveSpec({ path: '/tmp/anywhere/settings.yaml' })
    expect(spec.watch).toBe(true)
    expect(spec.debounceMs).toBe(100)
  })
})

describe('boot and reads', () => {
  it('resolves defaults over an absent file and reports writable', async () => {
    const dir = await tempDir()
    const path = join(dir, 'settings.yaml')
    const ctx = await boot({ path, watch: false })
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema, {
      base: { fontSize: 16 },
    })
    expect(scope.get()).toEqual({ theme: 'dark', fontSize: 16 })
    expect(ctx.settings.writable).toBe(true)
    expect(ctx.settings.documentPath).toBe(path)
  })

  it('prepares an absent owner-only document without changing resolved settings', async () => {
    const dir = await tempDir()
    const path = join(dir, 'nested', 'settings.yaml')
    const ctx = await boot({ path, watch: false })
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)

    await expect(ctx.settings.prepareDocument()).resolves.toBe(path)
    expect(await readFile(path, 'utf8')).toBe('')
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(scope.get()).toEqual({ theme: 'dark', fontSize: 14 })
  })

  it('preparing an existing document preserves its contents', async () => {
    const dir = await tempDir()
    const path = join(dir, 'settings.yaml')
    const contents = 'ui-theme:\n  theme: light\n'
    await writeFile(path, contents)
    const ctx = await boot({ path, watch: false })

    await expect(ctx.settings.prepareDocument()).resolves.toBe(path)
    expect(await readFile(path, 'utf8')).toBe(contents)
  })

  it('reads sections from an existing yaml document', async () => {
    const dir = await tempDir()
    const path = join(dir, 'settings.yaml')
    await writeFile(path, 'ui-theme:\n  theme: light\n')
    const ctx = await boot({ path, watch: false })
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
    expect(scope.get()).toEqual({ theme: 'light', fontSize: 14 })
  })

  it('reads sections from a json document', async () => {
    const dir = await tempDir()
    const path = join(dir, 'settings.json')
    await writeFile(path, JSON.stringify({ 'ui-theme': { fontSize: 18 } }))
    const ctx = await boot({ path, watch: false })
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
    expect(scope.get()).toEqual({ theme: 'dark', fontSize: 18 })
  })

  it('defaults the file location under the configured harness home', async () => {
    const dir = await tempDir()
    const ctx = await boot({ dshHome: dir, watch: false })
    expect(ctx.settings.documentPath).toBe(join(dir, 'settings.yaml'))
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
    await scope.update({ theme: 'light' })
    const written = await readFile(join(dir, 'settings.yaml'), 'utf8')
    expect(written).toContain('theme: light')
  })

  it('reads an empty yaml document as no sections', async () => {
    const dir = await tempDir()
    const path = join(dir, 'settings.yaml')
    await writeFile(path, '')
    const ctx = await boot({ path, watch: false })
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
    expect(scope.get()).toEqual({ theme: 'dark', fontSize: 14 })
  })

  it('reads an empty json document as no sections', async () => {
    const dir = await tempDir()
    const path = join(dir, 'settings.json')
    await writeFile(path, '')
    const ctx = await boot({ path, watch: false })
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
    expect(scope.get()).toEqual({ theme: 'dark', fontSize: 14 })
  })

  it.skipIf(process.platform === 'win32')('fails loud at boot when the document exists but is unreadable', async () => {
    const dir = await tempDir()
    const path = join(dir, 'settings.yaml')
    await writeFile(path, 'ui-theme:\n  theme: light\n')
    await chmod(path, 0o000)
    cleanups.push(() => chmod(path, 0o600))
    await expect(boot({ path, watch: false })).rejects.toThrow(/EACCES|permission/i)
  })

  it('fails loud when the document path names a directory', async () => {
    const dir = await tempDir()
    const path = join(dir, 'settings.yaml')
    await mkdir(path)
    await expect(boot({ path, watch: false })).rejects.toThrow(/EISDIR|directory/i)
  })

  it('fails loud on an unsupported extension', async () => {
    const dir = await tempDir()
    await expect(boot({ path: join(dir, 'settings.toml'), watch: false }))
      .rejects.toThrow(/not supported/)
  })

  it('fails loud at boot on unparsable yaml', async () => {
    const dir = await tempDir()
    const path = join(dir, 'settings.yaml')
    await writeFileAtomic(path, 'ui-theme: [unclosed\n', { mode: 0o600 })
    await expect(boot({ path, watch: false })).rejects.toThrow()
  })

  it('fails loud at boot when the root is not a map of sections', async () => {
    const dir = await tempDir()
    const path = join(dir, 'settings.yaml')
    await writeFile(path, '- just\n- a list\n')
    await expect(boot({ path, watch: false })).rejects.toThrow(/map of namespace sections/)
  })
})

describe('persist', () => {
  it('writes the merged section, creating the file with owner-only permissions', async () => {
    const dir = await tempDir()
    const path = join(dir, 'settings.yaml')
    const ctx = await boot({ path, watch: false })
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
    await scope.update({ theme: 'light' })

    const written = await readFile(path, 'utf8')
    expect(written).toContain('theme: light')
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600)
    // Atomic replace leaves no temp artifact behind.
    expect((await readdir(dir)).sort()).toEqual(['settings.yaml'])
  })

  it('serializes cross-namespace writes into one on-disk document', async () => {
    const dir = await tempDir()
    const path = join(dir, 'settings.yaml')
    const ctx = await boot({ path, watch: false })
    const alpha = ctx.settings.register(settingsNamespace('alpha'), ThemeSchema)
    const beta = ctx.settings.register(settingsNamespace('beta'), ThemeSchema)
    await Promise.all([
      alpha.update({ theme: 'light' }),
      beta.update({ fontSize: 20 }),
    ])
    const text = await readFile(path, 'utf8')
    expect(text).toContain('alpha:')
    expect(text).toContain('beta:')
    expect(alpha.get().theme).toBe('light')
    expect(beta.get().fontSize).toBe(20)
  })

  it('never follows a planted symlink at a temp path and never leaves the document a symlink', async () => {
    const dir = await tempDir()
    const path = join(dir, 'settings.yaml')
    const victim = join(dir, 'victim.txt')
    await writeFile(victim, 'precious')
    // A hostile sibling plants the historic fixed temp name as a symlink.
    await symlink(victim, `${path}.tmp`)
    const ctx = await boot({ path, watch: false })
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
    await scope.update({ theme: 'light' })

    expect(await readFile(victim, 'utf8')).toBe('precious')
    expect((await lstat(path)).isSymbolicLink()).toBe(false)
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(await readFile(path, 'utf8')).toContain('theme: light')
  })

  it('preserves comments and unregistered sections across updates', async () => {
    const dir = await tempDir()
    const path = join(dir, 'settings.yaml')
    await writeFile(path, [
      '# personal settings',
      'ui-theme:',
      '  theme: light',
      '# owned by a plugin that is not loaded right now',
      'future-plugin:',
      '  keep: me',
      '',
    ].join('\n'))
    const ctx = await boot({ path, watch: false })
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
    await scope.update({ fontSize: 18 })

    const written = await readFile(path, 'utf8')
    expect(written).toContain('# personal settings')
    expect(written).toContain('# owned by a plugin that is not loaded right now')
    expect(written).toContain('keep: me')
    expect(written).toContain('fontSize: 18')
    expect(written).toContain('theme: light')
  })

  it('keeps comments inside the section when a sibling key changes', async () => {
    const dir = await tempDir()
    const path = join(dir, 'settings.yaml')
    await writeFile(path, [
      'ui-theme:',
      '  # chosen during onboarding',
      '  theme: light',
      '  fontSize: 12',
      '',
    ].join('\n'))
    const ctx = await boot({ path, watch: false })
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
    await scope.update({ fontSize: 18 })
    const written = await readFile(path, 'utf8')
    expect(written).toContain('# chosen during onboarding')
    expect(written).toContain('theme: light')
    expect(written).toContain('fontSize: 18')
  })

  it('keeps a changed key\'s own-line comment while replacing its value', async () => {
    const dir = await tempDir()
    const path = join(dir, 'settings.yaml')
    await writeFile(path, [
      'ui-theme:',
      '  # chosen during onboarding',
      '  theme: light',
      '',
    ].join('\n'))
    const ctx = await boot({ path, watch: false })
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
    await scope.update({ theme: 'dark' })
    const written = await readFile(path, 'utf8')
    expect(written).toContain('# chosen during onboarding')
    expect(written).toContain('theme: dark')
  })

  it('deletes only the removed key on replace, keeping sibling comments', async () => {
    const dir = await tempDir()
    const path = join(dir, 'settings.yaml')
    await writeFile(path, [
      'ui-theme:',
      '  # chosen during onboarding',
      '  theme: light',
      '  fontSize: 12',
      '',
    ].join('\n'))
    const ctx = await boot({ path, watch: false })
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
    await scope.replace({ theme: 'light' })
    const written = await readFile(path, 'utf8')
    expect(written).toContain('# chosen during onboarding')
    expect(written).toContain('theme: light')
    expect(written).not.toContain('fontSize')
  })

  it('keeps an unchanged array\'s comments and replaces a changed array wholesale', async () => {
    const dir = await tempDir()
    const path = join(dir, 'settings.yaml')
    const TagsSchema: z<{ tags: string[]; label: string }> = z.object({
      tags: z.array(z.string()).default([]),
      label: z.string().default(''),
    })
    await writeFile(path, [
      'workspace:',
      '  tags:',
      '    # pinned by hand',
      '    - alpha',
      '  label: draft',
      '',
    ].join('\n'))
    const ctx = await boot({ path, watch: false })
    const scope = ctx.settings.register(settingsNamespace('workspace'), TagsSchema)
    await scope.update({ label: 'final' })
    const untouched = await readFile(path, 'utf8')
    expect(untouched).toContain('# pinned by hand')
    expect(untouched).toContain('label: final')
    // A changed array replaces wholesale; comments inside it go with it.
    await scope.update({ tags: ['beta'] })
    const replaced = await readFile(path, 'utf8')
    expect(replaced).not.toContain('# pinned by hand')
    expect(replaced).toContain('- beta')
  })

  it('keeps a comment-only document\'s comment when the first section lands', async () => {
    const dir = await tempDir()
    const path = join(dir, 'settings.yaml')
    // Parses to a null root: the document exists but holds no sections yet.
    await writeFile(path, '# reserved for future settings\n')
    const ctx = await boot({ path, watch: false })
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
    await scope.update({ theme: 'light' })
    const written = await readFile(path, 'utf8')
    expect(written).toContain('# reserved for future settings')
    expect(written).toContain('theme: light')
  })

  it('creates a json document from scratch', async () => {
    const dir = await tempDir()
    const path = join(dir, 'settings.json')
    const ctx = await boot({ path, watch: false })
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
    await scope.update({ theme: 'light' })
    const written = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    expect(written).toEqual({ 'ui-theme': { theme: 'light' } })
  })

  it('rejects and recovers when the document path becomes a directory', async () => {
    const dir = await tempDir()
    const path = join(dir, 'settings.yaml')
    const backup = join(dir, 'settings.committed.yaml')
    await writeFile(path, 'ui-theme:\n  theme: light\n')
    const ctx = await boot({ path, watch: false })
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
    await rename(path, backup)
    await mkdir(path)
    await expect(scope.update({ theme: 'dark' })).rejects.toThrow()
    await rm(path, { recursive: true })
    await rename(backup, path)
    expect((await readdir(dir)).sort()).toEqual(['settings.yaml'])
    expect(scope.get().theme).toBe('light')
    // The failed persist must not poison the document write chain.
    await scope.update({ theme: 'dark' })
    expect(scope.get().theme).toBe('dark')
  })

  it('round-trips a json document', async () => {
    const dir = await tempDir()
    const path = join(dir, 'settings.json')
    await writeFile(path, JSON.stringify({ other: { keep: true } }, null, 2))
    const ctx = await boot({ path, watch: false })
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
    await scope.update({ theme: 'light' })
    const written = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    expect(written).toEqual({ other: { keep: true }, 'ui-theme': { theme: 'light' } })
  })
})

describe('watch', () => {
  it('publishes an external edit to registered scopes', async () => {
    const dir = await tempDir()
    const path = join(dir, 'settings.yaml')
    await writeFile(path, 'ui-theme:\n  theme: light\n')
    const ctx = await boot({ path, debounceMs: 10 })
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
    expect(scope.get().theme).toBe('light')

    await writeFile(path, 'ui-theme:\n  theme: dark\n  fontSize: 20\n')
    await vi.waitFor(() => {
      expect(scope.get()).toEqual({ theme: 'dark', fontSize: 20 })
    }, { timeout: 5000 })
  })

  it('keeps the last good document over an invalid edit, then recovers', async () => {
    const dir = await tempDir()
    const path = join(dir, 'settings.yaml')
    await writeFile(path, 'ui-theme:\n  theme: light\n')
    const ctx = await boot({ path, debounceMs: 10 })
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)

    // Replace the external edit atomically so this case observes one complete
    // invalid document instead of a transient empty file during truncation.
    await writeFileAtomic(path, 'ui-theme: [unclosed\n', { mode: 0o600 })
    // The bad edit must never take the live tree down or reset the value.
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(scope.get()).toEqual({ theme: 'light', fontSize: 14 })

    await writeFileAtomic(path, 'ui-theme:\n  theme: dark\n', { mode: 0o600 })
    await vi.waitFor(() => {
      expect(scope.get().theme).toBe('dark')
    }, { timeout: 5000 })
  })

  it('treats file removal as an empty document', async () => {
    const dir = await tempDir()
    const path = join(dir, 'settings.yaml')
    await writeFile(path, 'ui-theme:\n  theme: light\n')
    const ctx = await boot({ path, debounceMs: 10 })
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)

    await rm(path)
    await vi.waitFor(() => {
      expect(scope.get()).toEqual({ theme: 'dark', fontSize: 14 })
    }, { timeout: 5000 })
  })

  it('does not republish its own persisted write', async () => {
    const dir = await tempDir()
    const path = join(dir, 'settings.yaml')
    const ctx = await boot({ path, debounceMs: 10 })
    const events: unknown[] = []
    ctx.on('settings/updated', (ns, _next, _prev, source) => {
      events.push({ ns, source })
    })
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
    await scope.update({ theme: 'light' })
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(events).toEqual([{ ns: 'ui-theme', source: 'update' }])
  })
})
