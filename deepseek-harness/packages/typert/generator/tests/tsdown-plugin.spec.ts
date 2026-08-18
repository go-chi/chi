import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceEmitResult } from '../src/workspace.ts'

const generated = vi.hoisted(() => vi.fn<() => WorkspaceEmitResult[]>(() => [
  {
    package: '@deepseek-ai/dsh-tools',
    packageRoot: 'packages/core/tools',
    face: 'host' as const,
    exports: [],
    js: 'export const host = true\n',
    dts: 'export declare const host: true\n',
    remote: {
      js: 'export const remote = true\n',
      dts: 'export declare const remote: true\n//# sourceMappingURL=typert.remote-client.d.ts.map\n',
      dtsMap: '{"version":3}\n',
    },
  },
  {
    package: '@deepseek-ai/dsh-tools',
    packageRoot: 'packages/core/tools',
    face: 'client' as const,
    exports: [],
    js: 'export const client = true\n',
    dts: 'export declare const client: true\n',
  },
  {
    package: '@fixture/remote-only',
    packageRoot: 'packages/remote-only',
    face: 'host' as const,
    exports: [],
    js: 'export const local = true\n',
    dts: 'export declare const local: true\n',
    remote: {
      js: 'export const remoteOnly = true\n',
      dts: 'export declare const remoteOnly: true\n//# sourceMappingURL=typert.remote-client.d.ts.map\n',
      dtsMap: '{"version":3}\n',
    },
  },
]))

const discovered = vi.hoisted(() => vi.fn(() => [
  { package: '@deepseek-ai/dsh-tools', root: 'packages/core/tools', faces: ['host'] },
  { package: '@fixture/ignored', root: 'packages/ignored', faces: ['host'] },
  { package: '@fixture/remote-only', root: 'packages/remote-only', faces: ['host'] },
]))

vi.mock('../src/workspace.ts', () => ({
  WorkspaceTypertGenerator: class {
    discover = discovered
    generate = generated
  },
}))

const { typertPlugin } = await import('../src/tsdown-plugin.ts')
const roots: string[] = []

afterEach(() => {
  discovered.mockClear()
  generated.mockClear()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('typertPlugin', () => {
  it('lowers standard decorators in TypeScript source dependencies', () => {
    const plugin = typertPlugin()
    expect(plugin.transform('export const value = 1\n', '/workspace/src/plain.ts')).toBeUndefined()
    expect(plugin.transform('@sealed\nexport class Example {}\n', '/workspace/src/example.ts')?.code)
      .not.toContain('@sealed')
  })

  it('skips outputs that do not identify a Typert contributor', async () => {
    const plugin = typertPlugin()
    expect(plugin.name).toBe('dsh-typert-generator')
    plugin.writeBundle({})

    const root = await workspace()
    const orphan = join(root, 'orphan', 'lib')
    await mkdir(orphan, { recursive: true })
    plugin.writeBundle({ dir: orphan })

    const unnamed = await packageOutput(root, 'unnamed', {})
    plugin.writeBundle({ dir: unnamed })
    const other = await packageOutput(root, 'other', { name: '@fixture/other' })
    plugin.writeBundle({ dir: other })

    expect(generated).not.toHaveBeenCalled()
    expect(() => { plugin.writeBundle({ dir: join(root, '..', 'outside', 'lib') }) })
      .toThrow('cannot find workspace root')
  })

  it('writes every generated face beside a nested package bundle', async () => {
    const root = await workspace()
    const output = await packageOutput(root, 'tools', {
      name: '@deepseek-ai/dsh-tools',
      exports: { './typert': './lib/typert.host.js' },
    }, 'lib/dev')
    const clientOutput = await packageOutput(root, 'client-tools', {
      name: '@deepseek-ai/dsh-tools',
      exports: { './client/typert': './lib/typert.client.js' },
    })

    const plugin = typertPlugin()
    plugin.writeBundle({ dir: output })
    plugin.writeBundle({ dir: clientOutput })

    expect(generated).toHaveBeenCalledOnce()
    expect(generated).toHaveBeenCalledWith()
    const packageLib = join(root, 'packages', 'tools', 'lib')
    expect(readFileSync(join(packageLib, 'typert.host.js'), 'utf8')).toBe('export const host = true\n')
    expect(readFileSync(join(packageLib, 'typert.host.d.ts'), 'utf8')).toBe('export declare const host: true\n')
    expect(readFileSync(join(packageLib, 'typert.client.js'), 'utf8')).toBe('export const client = true\n')
    expect(existsSync(join(packageLib, 'typert.client.d.ts'))).toBe(true)
    expect(readFileSync(join(packageLib, 'typert.remote-client.js'), 'utf8')).toBe('export const remote = true\n')
    expect(readFileSync(join(packageLib, 'typert.remote-client.d.ts'), 'utf8'))
      .toBe('export declare const remote: true\n//# sourceMappingURL=typert.remote-client.d.ts.map\n')
    expect(readFileSync(join(packageLib, 'typert.remote-client.d.ts.map'), 'utf8'))
      .toBe('{"version":3}\n')
    expect(readFileSync(join(root, 'packages/client-tools/lib/typert.client.js'), 'utf8'))
      .toBe('export const client = true\n')
  })

  it('generates a package opted in only through its Remote export', async () => {
    const root = await workspace()
    const output = await packageOutput(root, 'remote-only', {
      name: '@fixture/remote-only',
      exports: { './remote': './lib/typert.remote-client.js' },
    })

    typertPlugin().writeBundle({ dir: output })

    const packageLib = join(root, 'packages', 'remote-only', 'lib')
    expect(generated).toHaveBeenCalledOnce()
    expect(readFileSync(join(packageLib, 'typert.remote-client.js'), 'utf8'))
      .toBe('export const remoteOnly = true\n')
    expect(readFileSync(join(packageLib, 'typert.remote-client.d.ts'), 'utf8'))
      .toBe('export declare const remoteOnly: true\n//# sourceMappingURL=typert.remote-client.d.ts.map\n')
    expect(readFileSync(join(packageLib, 'typert.remote-client.d.ts.map'), 'utf8'))
      .toBe('{"version":3}\n')
  })

  it('removes stale Remote artifacts from a Host package without Remote output', async () => {
    const root = await workspace()
    const output = await packageOutput(root, 'tools', {
      name: '@deepseek-ai/dsh-tools',
      exports: { './typert': './lib/typert.host.js' },
    })
    const packageLib = join(root, 'packages', 'tools', 'lib')
    for (const file of [
      'typert.remote-client.js',
      'typert.remote-client.d.ts',
      'typert.remote-client.d.ts.map',
    ]) writeFileSync(join(packageLib, file), 'stale\n')
    generated.mockReturnValueOnce([{
      package: '@deepseek-ai/dsh-tools',
      packageRoot: 'packages/core/tools',
      face: 'host',
      exports: [],
      js: 'export const host = true\n',
      dts: 'export declare const host: true\n',
    }])

    typertPlugin().writeBundle({ dir: output })

    for (const file of [
      'typert.remote-client.js',
      'typert.remote-client.d.ts',
      'typert.remote-client.d.ts.map',
    ]) expect(existsSync(join(packageLib, file))).toBe(false)
  })

  it('emits every explicit workspace contributor once from a host-only prepass', async () => {
    const root = await workspace()
    const trigger = await packageOutput(root, 'generator', { name: '@deepseek-ai/dsh-typert-generator' })
    await packageOutput(root, 'core/tools', {
      name: '@deepseek-ai/dsh-tools',
      exports: { './typert': './lib/typert.host.js' },
    })
    await packageOutput(root, 'ignored', { name: '@fixture/ignored' })
    await packageOutput(root, 'remote-only', {
      name: '@fixture/remote-only',
      exports: { './remote': './lib/typert.remote-client.js' },
    })

    const plugin = typertPlugin({ mode: 'workspace', faces: ['host'] })
    plugin.writeBundle({ dir: trigger })
    plugin.writeBundle({ dir: join(root, 'packages/core/tools/lib/dev') })

    expect(discovered).toHaveBeenCalledOnce()
    expect(discovered).toHaveBeenCalledWith(['host'])
    expect(generated).toHaveBeenCalledOnce()
    expect(generated).toHaveBeenCalledWith(
      ['@deepseek-ai/dsh-tools', '@fixture/remote-only'],
      ['host'],
    )
    expect(readFileSync(join(root, 'packages/core/tools/lib/typert.host.js'), 'utf8'))
      .toBe('export const host = true\n')
    expect(readFileSync(join(root, 'packages/remote-only/lib/typert.remote-client.js'), 'utf8'))
      .toBe('export const remoteOnly = true\n')
    expect(existsSync(join(root, 'packages/ignored/lib/typert.host.js'))).toBe(false)
  })
})

async function workspace(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'dsh-typert-tsdown-'))
  roots.push(root)
  writeFileSync(join(root, 'tsconfig.host.json'), '{}\n')
  return root
}

async function packageOutput(
  root: string,
  directory: string,
  manifest: Record<string, unknown>,
  output = 'lib',
): Promise<string> {
  const packageRoot = join(root, 'packages', directory)
  const result = join(packageRoot, output)
  await mkdir(result, { recursive: true })
  writeFileSync(join(packageRoot, 'package.json'), `${JSON.stringify(manifest)}\n`)
  return result
}
