import { existsSync } from 'node:fs'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const builtIndex = join(packageRoot, 'lib', 'index.js')
const builtWorker = join(packageRoot, 'lib', 'worker.cjs')
const run = promisify(execFile)

/**
 * Keyless built-artifact guard: plain Node loads `lib/index.js` and its sibling
 * `lib/worker.cjs` without tsx. Skips until the build produces both bundles.
 */
describe.skipIf(!existsSync(builtIndex) || !existsSync(builtWorker))('built worker entry (lib/worker.cjs)', () => {
  it('the built engine spawns its built worker under plain node and completes a run', async () => {
    // Keep the driver in-package so bare imports resolve its node_modules.
    const driver = join(packageRoot, `.built-worker-driver-${process.pid}.mjs`)
    try {
      await writeFile(driver, `
import { Context } from '@deepseek-ai/cordis'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import WorkerThreadWorkflowEngine from '@deepseek-ai/dsh-workflow-worker-thread'

const ctx = new Context()
await ctx.plugin(SubagentRuntime)
let selectedStarts = 0
ctx.subagents.registerProvider({
  name: 'built-selected',
  capabilities: { outputSchema: true, depthLimit: false, toolFilter: false, persona: false },
  inheritsParentContext: false,
  async start() {
    selectedStarts += 1
    return {
      id: 'built-child',
      result: Promise.resolve({ output: [], structured: { answer: 42 }, stopReason: 'completed' }),
      dispose: () => Promise.resolve(),
    }
  },
})
await ctx.plugin(WorkerThreadWorkflowEngine, { provider: 'must-not-be-used' })
const run = ctx.workflowEngine.start({
  script: "const value = await agent('answer', { schema: { type: 'object', properties: { answer: { type: 'number' } }, required: ['answer'] } }); return value.answer",
  meta: { name: 'built-smoke', description: 'built worker smoke' },
  subagentProvider: 'built-selected',
  parent: { id: 'built-smoke-parent', options: {} },
})
const result = await run.result
await run.dispose()
if (result.stopReason !== 'completed' || result.value !== 42 || selectedStarts !== 1) {
  console.error('unexpected result: ' + JSON.stringify(result))
  process.exit(1)
}
console.log('built-worker-smoke-ok')
`, 'utf8')
      const { stdout } = await run(process.execPath, [driver], { cwd: packageRoot, timeout: 60_000 })
      expect(stdout).toContain('built-worker-smoke-ok')
    } finally {
      await rm(driver, { force: true })
    }
  }, 120_000)
})
