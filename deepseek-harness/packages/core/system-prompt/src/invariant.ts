/** Package-owned prompt-assembly invariants. @module @deepseek-ai/dsh-system-prompt/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { PromptAssembly } from './index.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-system-prompt'
const VARIABLE_NAME = /^[a-z][a-z0-9_]*$/

/** Cordis companion plugin name. */
export const name = 'system-prompt-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Validate the authoritative assembly returned by the waterfall. */
function validateAssembly(assembly: PromptAssembly, fail: InvariantFailure): void {
  const sectionNames = new Set<string>()
  for (const section of assembly.sections) {
    if (section.name.length === 0) fail('assembled section names must be non-empty')
    if (sectionNames.has(section.name)) fail(`assembled section name ${JSON.stringify(section.name)} is duplicated`)
    sectionNames.add(section.name)
    if (typeof section.text !== 'string') fail(`assembled section ${JSON.stringify(section.name)} text must be a string`)
  }

  const contextNames = new Set<string>()
  for (const context of assembly.contexts) {
    if (context.name.length === 0) fail('assembled context names must be non-empty')
    if (contextNames.has(context.name)) fail(`assembled context name ${JSON.stringify(context.name)} is duplicated`)
    contextNames.add(context.name)
    if (typeof context.text !== 'string') fail(`assembled context ${JSON.stringify(context.name)} text must be a string`)
  }

  for (const tool of assembly.tools) {
    if (tool.name.length === 0) fail('assembled tool names must be non-empty')
  }

  for (const [name, value] of Object.entries(assembly.variables)) {
    if (!VARIABLE_NAME.test(name)) fail(`assembled variable name ${JSON.stringify(name)} is invalid`)
    if (value !== undefined && typeof value !== 'string') {
      fail(`assembled variable ${JSON.stringify(name)} must be a string or undefined`)
    }
  }
}

/** Install validation around the authoritative assembly waterfall result. */
const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const assembled = await next()
    validateAssembly(assembled, fail)
    return assembled
  }, { global: true, prepend: true })
}

/**
 * Register the system-prompt invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
