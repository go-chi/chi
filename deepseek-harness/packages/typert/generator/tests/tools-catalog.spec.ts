import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry/types'
import { EVENT_API, SERVICE_API, TYPE_API } from '@deepseek-ai/dsh-tool-cordis/src/api-catalog.ts'
import { WorkspaceAnalyzer } from '../src/analyzer.ts'
import { FaceModelEmitter } from '../src/emitter.ts'

const workspaceRoot = resolve(import.meta.dirname, '../../../..')
const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('model-driven dsh-tools generation', () => {
  it('round-trips the complete service and event structure through the runtime registry', { timeout: 30_000 }, async () => {
    const workspace = new WorkspaceAnalyzer({
      root: workspaceRoot,
      faces: ['host'],
      packages: ['@deepseek-ai/dsh-tools'],
    }).analyze()
    const host = workspace.faces.find(candidate => candidate.face === 'host')
    if (host === undefined) throw new Error('dsh-tools has no analyzed host face')
    const artifact = new FaceModelEmitter(host).emit('@deepseek-ai/dsh-tools')

    const root = mkdtempSync(join(import.meta.dirname, '.generated-tools-'))
    temporaryRoots.push(root)
    const modulePath = join(root, 'host.mjs')
    writeFileSync(modulePath, artifact.js)
    const generated = await import(`${pathToFileURL(modulePath).href}?test=${Date.now()}`) as {
      TYPERT: TypertContribution
    }

    const ctx = new Context()
    await ctx.plugin(TypertRegistry)
    const dispose = ctx.typert.register(generated.TYPERT)
    const record = ctx.typert.getPackage('@deepseek-ai/dsh-tools', 'host')
    const service = record?.model.services.find(candidate => candidate.key === 'tools')
    expect(service).toBeDefined()
    expect({
      key: service?.key,
      summary: service?.summary,
      methods: service?.members
        .filter(member => member.kind === 'method' && !member.name.startsWith('['))
        .map(member => member.signature),
    }).toEqual((() => {
      const api = SERVICE_API.find(candidate => candidate.key === 'tools')
      return {
        key: api?.key,
        summary: api?.summary,
        methods: api?.methods.map(method => method.signature),
      }
    })())
    expect(record?.model.events.filter(event => event.name.startsWith('tools/')).map(event => ({
      name: event.name,
      mode: event.mode,
      signature: event.signature,
      summary: event.summary,
    }))).toEqual(EVENT_API.filter(event => event.name.startsWith('tools/')).map(event => ({
      name: event.name,
      mode: event.mode,
      signature: event.signature,
      summary: event.summary,
    })))
    expect(service?.types.find(type => type.name === 'ToolDefinition')).toEqual(
      TYPE_API.find(type => type.name === 'ToolDefinition'),
    )

    await dispose()
    expect(ctx.typert.getPackage('@deepseek-ai/dsh-tools', 'host')).toBeUndefined()
  })
})
