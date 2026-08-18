import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, rm, writeFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Keyless built-artifact smoke: plain Node imports `@deepseek-ai/dsh-lsp` and
 * `@deepseek-ai/dsh-lsp-stdio` by name through their exports maps, spawns the fixture server, runs
 * one query (exercising real `Content-Length` framing over `lib/index.js`), and disposes (exercising
 * subprocess cleanup). Unit tests use `src/`; this pins the downstream `lib/` path. Skips when `lib/`
 * is absent; CI runs it after the build.
 */

const pkgDir = fileURLToPath(new URL('..', import.meta.url))
const seamLib = join(pkgDir, '../lsp/lib/index.js')
const fsLib = join(pkgDir, '../../fs/fs-local/lib/index.js')
const subprocessLib = join(pkgDir, '../../subprocess/subprocess-local/lib/index.js')
const built = existsSync(join(pkgDir, 'lib/index.js')) && existsSync(seamLib) && existsSync(fsLib) && existsSync(subprocessLib)

const fixtureServer = fileURLToPath(new URL('./fixture-server.ts', import.meta.url))

let root: string
let ws: string

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'lsp-built-')))
  ws = join(root, 'ws')
  await mkdir(ws)
  await writeFile(join(ws, 'a.ts'), 'const x = 1\n')
})

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true })
})

describe.skipIf(!built)('built lib real load path (plain node)', () => {
  it('runs a query through lib/index.js and disposes cleanly, framing over the base protocol', async () => {
    const location = JSON.stringify({ uri: pathToFileURL(join(ws, 'a.ts')).href, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } } })
    const script = `
      const { Context } = await import('@deepseek-ai/cordis')
      const { default: Lsp } = await import('@deepseek-ai/dsh-lsp')
      const LspLocal = await import('@deepseek-ai/dsh-lsp-stdio')
      const { default: LocalFileSystem } = await import('@deepseek-ai/dsh-fs-local')
      const { default: LocalSubprocessRuntime } = await import('@deepseek-ai/dsh-subprocess-local')
      const ctx = new Context()
      await ctx.plugin(Lsp)
      await ctx.plugin(LocalSubprocessRuntime)
      await ctx.plugin(LocalFileSystem, { cwd: process.cwd() })
      await ctx.plugin(LspLocal, {
        servers: {
          fake: {
            command: ${JSON.stringify(process.execPath)},
            args: [${JSON.stringify(fixtureServer)}],
            env: { LSP_FAKE_DEF: ${JSON.stringify(location)} },
            extensionToLanguage: { '.ts': 'typescript' },
          },
        },
      })
      const result = await ctx.lsp.query({ operation: 'goToDefinition', filePath: 'a.ts', position: { line: 0, character: 6 }, workspaceRoot: ${JSON.stringify(ws)} })
      console.log(JSON.stringify(result))
      await ctx.fiber.dispose()
    `
    const { exitCode, stdout, stderr } = await execa(process.execPath, ['--input-type=module', '-e', script], {
      cwd: pkgDir,
      stdin: 'ignore',
      timeout: 55_000,
      killSignal: 'SIGKILL',
      reject: false,
    })

    expect(exitCode, `stderr:\n${stderr}`).toBe(0)
    const lastLine = stdout.trim().split('\n').at(-1) ?? ''
    const result = JSON.parse(lastLine) as { kind: string; locations: unknown[] }
    expect(result.kind).toBe('locations')
    expect(result.locations).toHaveLength(1)
  }, 60_000)
})
