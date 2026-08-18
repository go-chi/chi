import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'

/**
 * Keyless built-artifact smoke: plain Node imports the package by name through its exports map,
 * then exercises type stripping, sibling `worker.cjs` loading, bindings, and logs. Unit tests use
 * `src/worker.ts`; this pins the downstream `lib/index.js` path. It skips when `lib/` is absent,
 * and CI runs it after the build.
 */

const pkgDir = fileURLToPath(new URL('..', import.meta.url))
const built = ['lib/index.js', 'lib/worker.cjs'].every(file => existsSync(join(pkgDir, file)))
  && existsSync(join(pkgDir, '../code-runtime/lib/index.js'))

describe.skipIf(!built)('built lib real load path (plain node)', () => {
  it('runs a TypeScript program with a binding through lib/index.js and its lib/worker.cjs entry', async () => {
    const script = `
      const { Context } = await import('@deepseek-ai/cordis')
      const { WorkerThreadCodeRuntime } = await import('@deepseek-ai/dsh-code-runtime-worker-thread')
      const ctx = new Context()
      await ctx.plugin(WorkerThreadCodeRuntime, {})
      const result = await ctx.codeRuntime.run({
        program: 'const doubled: number = await tools.double({ n: 21 }); console.log("halfway", doubled); let failure; try { await tools.fail({}) } catch (error) { failure = { typed: error instanceof ToolCallError, name: error.name, toolName: error.toolName, message: error.message } } return { doubled, failure };',
        bindings: [{
          global: 'tools',
          functions: {
            double: async args => args.n * 2,
            fail: async () => { throw new Error('denied') },
          },
          errorClass: { name: 'ToolCallError', memberNameProperty: 'toolName' },
        }],
      })
      console.log(JSON.stringify(result))
      process.exit(0)
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
    const result = JSON.parse(lastLine) as { value?: unknown; logs: string[]; error?: unknown }
    expect(result.error).toBeUndefined()
    expect(result.value).toEqual({
      doubled: 42,
      failure: { typed: true, name: 'ToolCallError', toolName: 'fail', message: 'denied' },
    })
    expect(result.logs).toContain('halfway 42')
  })
})
