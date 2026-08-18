/**
 * Real-composition guard: the provider and a consumer plugin boot from a
 * test-only cordis.yml through the actual Loader + Include path, an external
 * edit of settings.yaml hot-publishes into the consumer's scope, and the same
 * consumer booted WITHOUT a settings entry keeps its entry-config resolution —
 * the documented optional-inject fallback.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import z from '@deepseek-ai/schemastery'
import { settingsNamespace, type SettingsScope } from '@deepseek-ai/dsh-settings'
import FileSettingsProvider from '../src/index.ts'

interface ThemeConfig {
  theme: 'dark' | 'light'
  fontSize: number
}

const ThemeSchema: z<ThemeConfig> = z.object({
  theme: z.union(['dark', 'light']).default('dark'),
  fontSize: z.number().default(14),
})

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

interface ConsumerState {
  scope: SettingsScope<ThemeConfig> | undefined
  seen: ThemeConfig[]
  /** What the consumer is actually running with, settings or not. */
  applied: ThemeConfig | undefined
}

async function loadComposition(
  options?: { withSettings?: boolean },
): Promise<{ ctx: Context; state: ConsumerState; settingsPath: string }> {
  const withSettings = options?.withSettings ?? true
  root = await mkdtemp(join(tmpdir(), 'dsh-settings-composition-'))
  const settingsPath = join(root, 'settings.yaml')
  await writeFile(settingsPath, 'ui-theme:\n  theme: light\n')

  const state: ConsumerState = { scope: undefined, seen: [], applied: undefined }
  const consumer = {
    name: 'settings-consumer',
    apply: (ctx: Context) => {
      // The documented consumer shape: no hard dependency — entry config alone
      // is the running state, and the scoped inject overlays the user layer
      // only while a settings service exists.
      const base: Partial<ThemeConfig> = { fontSize: 16 }
      state.applied = ThemeSchema(base as ThemeConfig)
      ctx.inject(['settings'], (child: Context) => {
        const scope = child.settings.register(settingsNamespace('ui-theme'), ThemeSchema, { base })
        state.scope = scope
        state.applied = scope.get()
        scope.watch((next) => {
          state.seen.push(next)
          state.applied = next
        })
      })
    },
  }

  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    ...withSettings
      ? [
        '- id: settings',
        "  name: '@deepseek-ai/dsh-settings-file'",
        '  config:',
        `    path: ${JSON.stringify(settingsPath)}`,
        '    debounceMs: 10',
      ]
      : [],
    '- id: consumer',
    '  name: test-settings-consumer',
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-settings-file', FileSettingsProvider],
    ['test-settings-consumer', consumer],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await ctx.loader.await()
  return { ctx, state, settingsPath }
}

describe('settings-file real composition', () => {
  it('boots from cordis.yml and hot-publishes an external settings edit', async () => {
    const { ctx, state, settingsPath } = await loadComposition()

    // Composition resolution: user layer over the consumer's composition base.
    await vi.waitFor(() => {
      expect(state.scope!.get()).toEqual({ theme: 'light', fontSize: 16 })
    })
    expect(ctx.get('settings')!.describe().map(entry => entry.ns)).toEqual(['ui-theme'])

    await writeFile(settingsPath, 'ui-theme:\n  theme: dark\n  fontSize: 20\n')
    await vi.waitFor(() => {
      expect(state.scope!.get()).toEqual({ theme: 'dark', fontSize: 20 })
    }, { timeout: 5000 })
    expect(state.seen.at(-1)).toEqual({ theme: 'dark', fontSize: 20 })
  })

  it('boots the same consumer without a settings entry and keeps entry-config resolution', async () => {
    const { ctx, state } = await loadComposition({ withSettings: false })

    // No settings service anywhere in the composition…
    expect(ctx.get('settings')).toBeUndefined()
    // …so the consumer runs on schema defaults plus its composition base, and
    // never receives a scope.
    expect(state.applied).toEqual({ theme: 'dark', fontSize: 16 })
    expect(state.scope).toBeUndefined()
    expect(state.seen).toEqual([])
  })
})
