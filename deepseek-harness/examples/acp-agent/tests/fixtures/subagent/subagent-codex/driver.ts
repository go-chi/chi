#!/usr/bin/env node
/** Inspect the public Codex provider composition without invoking the product. */

import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-tools'

const configPath = process.argv[2]
if (configPath === undefined) {
  throw new Error('subagent-codex Loader composition driver requires a config path')
}

let starts = 0
const ctx = await boot(
  'subagent-codex-loader-composition',
  resolveConfigPath(configPath, undefined),
  undefined,
  (hostCtx) => {
    hostCtx.on('subagent/start', () => {
      starts += 1
    })
  },
)

try {
  const provider = ctx.subagents.getProvider('codex')
  if (provider === undefined) throw new Error('Codex provider was not registered')
  const tool = ctx.tools.schemas().find(schema => schema.name === 'subagent_codex')
  if (tool === undefined) throw new Error('subagent_codex tool was not registered')
  const properties = tool.parameters.properties
  if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) {
    throw new Error('subagent_codex tool has invalid parameter properties')
  }
  const jobTools = ctx.tools.schemas()
    .map(schema => schema.name)
    .filter(name => name === 'job_kill' || name === 'job_list' || name === 'job_output')
    .sort()

  process.stdout.write(`${JSON.stringify({
    providers: ctx.subagents.list(),
    provider: {
      name: provider.name,
      capabilities: provider.capabilities,
      inheritsParentContext: provider.inheritsParentContext,
    },
    tool: {
      name: tool.name,
      parameterNames: Object.keys(properties).sort(),
      required: tool.parameters.required,
    },
    jobTools,
    starts,
  })}\n`)
} finally {
  await ctx.fiber.dispose()
}
