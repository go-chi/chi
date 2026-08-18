/**
 * Model-facing Cordis runtime/package inspection, define, run, stop, and remove tools.
 * @module @deepseek-ai/dsh-tool-cordis
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import {
  CordisDynamicPackageId, CordisDynamicPluginId,
} from '@deepseek-ai/dsh-cordis-host-runner'
import type { DynamicCordisReference } from '@deepseek-ai/dsh-cordis-host-runner'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { missingServices, providedServices } from './inspect.ts'
import {
  presentDefineCall, presentInspectListCall, presentInspectQueryCall, presentInspectSelfCall, presentRunCall,
  presentStopCall, presentUndefineCall,
} from './present.ts'
import { CORDIS_SYSTEM_PROMPT } from './prompt.ts'
import { hostInspectProviders } from './providers.ts'

export const name = 'tool-cordis'
export const inject = ['tools', 'systemPrompt', 'dynamicCordisRunner', 'cordisInspect']

function requireAgent(exec: ToolExecution): Agent {
  if (exec.agent === undefined) throw new Error('Cordis dynamic tools require an Agent-backed session')
  return exec.agent
}

/** Register the Cordis tools and explicit `@pluginId` context injection. */
export function apply(ctx: Context): void {
  ctx.systemPrompt.section({ name: 'tool:cordis', order: 115, text: CORDIS_SYSTEM_PROMPT })
  for (const provider of hostInspectProviders(ctx)) {
    ctx.effect(() => ctx.cordisInspect.register(provider), `tool-cordis: inspect ${provider.manifest.id}`)
  }

  ctx.tools.register(defineTool({
    name: 'cordis_inspect_list',
    description:
      'List every Cordis Inspect Provider currently known to the Host, including local Host Providers and the latest '
      + 'manifests synchronized from the Client. Each entry includes its platform, purpose, read-only methods, and '
      + 'input/output schemas. Call this Tool before creating or modifying a Package, then select the provider and '
      + 'method for cordis_inspect_query from its result. Do not guess names or treat an Inspect method as a business '
      + 'Service that Plugin code can call.',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    execute(_args, _exec): Promise<JsonValue> {
      return Promise.resolve({ providers: ctx.cordisInspect.list() } as unknown as JsonValue)
    },
    presentCall: presentInspectListCall,
  }))

  ctx.tools.register(defineTool({
    name: 'cordis_inspect_query',
    description:
      'Run a read-only query explicitly declared by an Inspect Provider. platform, provider, and method must come '
      + 'from cordis_inspect_list, and input must satisfy that method\'s schema. Use this Tool before cordis_define '
      + 'to read exact Service methods, Event modes, Builtin signatures, Tool schemas, theme tokens, or live Slot '
      + 'trees and props. Host queries run locally. A Client query waits for the first valid page response and '
      + 'remains pending until a page answers or the Tool is cancelled. This Tool cannot invoke business Service '
      + 'methods or modify the runtime. For Service.listService and Event.listEvents, query without input to navigate '
      + 'the compact signature directory, then query the exact service or event for its structured contract and '
      + 'referenced types. For Slots.listSubTree, query without root to navigate the compact tree, then query the '
      + 'exact root for its complete registration contract and props.',
    parameters: {
      platform: { type: 'string', required: true, enum: ['host', 'client'], description: 'Runtime platform that owns the Provider.' },
      provider: { type: 'string', required: true, description: 'Exact Provider ID returned by cordis_inspect_list.' },
      method: { type: 'string', required: true, description: 'Exact method name declared by the Provider manifest.' },
      input: { type: 'json', description: 'Optional query input; it must satisfy the method input schema.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      const data = await ctx.cordisInspect.query(
        args.platform,
        args.provider,
        args.method,
        args.input,
        requireAgent(exec),
        exec.signal,
      )
      return { platform: args.platform, provider: args.provider, method: args.method, data }
    },
    presentCall: presentInspectQueryCall,
  }))

  ctx.tools.register(defineTool({
    name: 'cordis_inspect_self',
    description:
      'Inspect dynamic Cordis objects owned by the current Session at increasing levels of detail. With no IDs, '
      + 'list only Plugin summaries. With pluginId alone, return version pointers, the latest Run, and every Package '
      + 'summary. Only pluginId plus packageId returns that immutable Package\'s Host/Client source and runtime '
      + 'diagnostics. packageId cannot be supplied alone. Query an exact Package before handling @pluginId, repairing '
      + 'an asynchronous failure, or defining an updated version. This Tool is read-only: it neither executes code '
      + 'nor changes version pointers.',
    parameters: {
      pluginId: { type: 'string', description: 'Stable Plugin ID returned by cordis_define or injected by @pluginId; omit it to list every current Plugin.' },
      packageId: { type: 'string', description: 'Exact immutable Package ID owned by pluginId; when specified, source and diagnostics are returned.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    execute(args, exec): Promise<JsonValue> {
      const agent = requireAgent(exec)
      if (args.packageId !== undefined && args.pluginId === undefined) {
        throw new Error('cordis_inspect_self packageId requires pluginId')
      }
      if (args.pluginId === undefined) {
        return Promise.resolve({
          mode: 'plugins',
          plugins: ctx.dynamicCordisRunner.listPlugins(agent).map(reference => selfSummary(reference)),
        } as unknown as JsonValue)
      }
      const pluginId = CordisDynamicPluginId(args.pluginId)
      if (args.packageId === undefined) {
        const plugin = ctx.dynamicCordisRunner.inspectPlugin(agent, pluginId)
        return Promise.resolve({
          mode: 'plugin',
          ...selfSummary(plugin),
          packages: plugin.packages.map(pkg => ({
            ...pkg,
            packageId: String(pkg.packageId),
            isCurrent: pkg.packageId === plugin.currentPackageId,
            isNext: pkg.packageId === plugin.nextPackageId,
          })),
        } as unknown as JsonValue)
      }
      return Promise.resolve(inspectSelfPackage(
        ctx,
        agent,
        pluginId,
        CordisDynamicPackageId(args.packageId),
      ) as unknown as JsonValue)
    },
    presentCall: presentInspectSelfCall,
  }))

  ctx.tools.register(defineTool({
    name: 'cordis_define',
    description:
      'Define an immutable Cordis Package. For a new Plugin, use kind:"new" and provide only a semantic prefix of '
      + '3–6 lowercase English letters; the Host returns the final pluginId and packageId. To modify an existing '
      + 'Plugin, use kind:"existing" with its exact pluginId to append a Package without overwriting older versions. '
      + 'Provide at least one of code.host and code.client. Each value is a plain JavaScript function body that returns '
      + 'a Cordis Plugin; no TypeScript, JSX, or import transformation occurs. Query Inspect before depending on a '
      + 'Service, Event, Builtin, Slot, or token. Define only validates parameters and syntax and records source: it '
      + 'does not request approval, execute apply, or change currentPackageId. On success, call cordis_run with the '
      + 'returned IDs.',
    parameters: {
      plugin: {
        required: true,
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', const: 'new', required: true },
              idPrefix: {
                type: 'string',
                required: true,
                description: 'Suggested semantic prefix of 3–6 lowercase English letters; the Host adds a unique numeric suffix.',
              },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', const: 'existing', required: true },
              pluginId: { type: 'string', required: true, description: 'Exact ID of an existing Plugin; the new Package is appended to that instance.' },
            },
          },
        ],
      },
      name: { type: 'string', required: true, description: 'Short, readable Package name.' },
      purpose: { type: 'string', required: true, description: 'One-sentence, user-facing description of the Package purpose.' },
      code: {
        type: 'object',
        additionalProperties: false,
        required: true,
        properties: {
          host: { type: 'string', description: 'Plain JavaScript function body that returns the Host-half Cordis Plugin.' },
          client: { type: 'string', description: 'Plain JavaScript function body that returns the browser Client-half Cordis Plugin.' },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          pluginId: { type: 'string', required: true },
          packageId: { type: 'string', required: true },
          name: { type: 'string', required: true },
          purpose: { type: 'string', required: true },
          hasHostHalf: { type: 'boolean', required: true },
          hasClientHalf: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Defined ${value.pluginId}/${value.packageId} (${value.name}); it is not running yet. `
          + 'Use cordis_run to activate this Package.',
      }],
      presentationMeta: (_args, value) => ({ pluginId: value.pluginId, packageId: value.packageId }),
    },
    execute(args, exec) {
      const plugin = args.plugin.kind === 'new'
        ? { kind: 'new' as const, idPrefix: args.plugin.idPrefix }
        : { kind: 'existing' as const, pluginId: CordisDynamicPluginId(args.plugin.pluginId) }
      const receipt = ctx.dynamicCordisRunner.define({
        sessionId: requireAgent(exec).id,
        plugin,
        name: args.name,
        purpose: args.purpose,
        code: {
          ...args.code.host === undefined ? {} : { host: args.code.host },
          ...args.code.client === undefined ? {} : { client: args.code.client },
        },
      })
      return Promise.resolve({
        ...receipt,
        pluginId: String(receipt.pluginId),
        packageId: String(receipt.packageId),
      })
    },
    presentCall: presentDefineCall,
  }))

  ctx.tools.register(defineTool({
    name: 'cordis_run',
    description:
      'Activate one exact Package of a dynamic Plugin. Use mode:"run" for the first activation, restarting '
      + 'currentPackageId, or rollback. When current exists, use mode:"update" to switch to a different Package, '
      + 'even if the Plugin is currently stopped. An unauthorized Client Package creates an approval request and '
      + 'returns awaiting-approval; an authorized Package returns starting and continues asynchronously in the '
      + 'browser. Neither result waits for the final outcome inside the Tool. currentPackageId changes only after '
      + 'complete success; on failure, the old current and target next remain. Asynchronous success, rejection, or '
      + 'technical failure is reported through state and steering. After a technical failure, read diagnostics with '
      + 'cordis_inspect_self, correct the same Plugin, and retry autonomously. Do not request approval again after '
      + 'the user rejects it.',
    parameters: {
      pluginId: { type: 'string', required: true, description: 'Stable Plugin ID returned by cordis_define.' },
      packageId: { type: 'string', required: true, description: 'Exact immutable Package ID to activate under that Plugin.' },
      mode: {
        type: 'string',
        required: true,
        enum: ['run', 'update'],
        description: 'Use run for the first activation, restarting current, or rollback; use update to switch from current to a different Package.',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => {
        const result = requireJsonObject(value)
        const pluginId = requireJsonString(result, 'pluginId')
        const packageId = requireJsonString(result, 'packageId')
        const pluginRunId = requireJsonString(result, 'pluginRunId')
        return [{
          type: 'text',
          text: result.status === 'awaiting-approval'
            ? `${pluginId}/${packageId} is awaiting user approval (${pluginRunId}).`
            : result.status === 'starting'
              ? `${pluginId}/${packageId} is starting asynchronously (${pluginRunId}).`
              : `${pluginId}/${packageId} is running (${pluginRunId}).`,
        }]
      },
      presentationMeta: (_args, value) => {
        const result = requireJsonObject(value)
        return {
          pluginId: requireJsonString(result, 'pluginId'),
          packageId: requireJsonString(result, 'packageId'),
          pluginRunId: requireJsonString(result, 'pluginRunId'),
        }
      },
    },
    async execute(args, exec) {
      const agent = requireAgent(exec)
      const pluginId = CordisDynamicPluginId(args.pluginId)
      const packageId = CordisDynamicPackageId(args.packageId)
      const receipt = await ctx.dynamicCordisRunner.run(agent, pluginId, packageId, args.mode, exec.signal)
      if (!receipt.ok) throw new Error(receipt.message)
      if (receipt.status !== 'running') {
        return {
          status: receipt.status,
          pluginId: args.pluginId,
          packageId: args.packageId,
          pluginRunId: String(receipt.pluginRunId),
          mode: receipt.mode,
          ...receipt.currentPackageId === undefined ? {} : { currentPackageId: String(receipt.currentPackageId) },
          nextPackageId: String(receipt.nextPackageId),
        }
      }
      const row = ctx.dynamicCordisRunner.snapshot(agent).find(candidate => candidate.pluginId === pluginId)
      const fiber = row?.activeRun?.pluginRunId === receipt.pluginRunId ? row.activeRun.fiber : undefined
      return {
        status: 'running',
        pluginId: args.pluginId,
        packageId: args.packageId,
        pluginRunId: String(receipt.pluginRunId),
        currentPackageId: String(receipt.currentPackageId),
        ...receipt.nextPackageId === undefined ? {} : { nextPackageId: String(receipt.nextPackageId) },
        host: {
          status: fiber === undefined ? 'absent' : missingServices(ctx, fiber).length === 0 ? 'running' : 'waiting',
          provides: fiber === undefined ? [] : providedServices(ctx, fiber),
          waitingFor: fiber === undefined ? [] : missingServices(ctx, fiber),
        },
        client: {
          status: receipt.clientWaitingFor === undefined
            ? 'absent'
            : receipt.clientWaitingFor.length === 0 ? 'running' : 'waiting',
          waitingFor: [...(receipt.clientWaitingFor ?? [])],
        },
      }
    },
    presentCall: presentRunCall,
  }))

  ctx.tools.register(defineTool({
    name: 'cordis_stop',
    description:
      'Stop the current Run of a dynamic Plugin and cancel unfinished approval or activation requests. Retain the '
      + 'Plugin, every immutable Package, grants, currentPackageId, and nextPackageId so it can later run or update '
      + 'directly. Stopping an already stopped Plugin succeeds idempotently. Use this Tool to disable effects '
      + 'temporarily; use cordis_undefine for permanent removal.',
    parameters: {
      pluginId: { type: 'string', required: true, description: 'Stable dynamic Plugin ID to stop.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { pluginId: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: `Dynamic Plugin ${value.pluginId} is stopped; its definition and versions remain.` }],
    },
    async execute(args, exec) {
      const receipt = await ctx.dynamicCordisRunner.stop(requireAgent(exec), CordisDynamicPluginId(args.pluginId))
      if (!receipt.ok && receipt.reason !== 'not-running') throw new Error(receipt.message)
      return { pluginId: args.pluginId }
    },
    presentCall: presentStopCall,
  }))

  ctx.tools.register(defineTool({
    name: 'cordis_undefine',
    description:
      'Permanently remove a dynamic Plugin owned by the current Session. If it is running or awaiting approval, '
      + 'first stop it and cancel the request, then delete every Package, grant, and version pointer. After this '
      + 'returns, its pluginId, packageIds, @ reference, and Package business views are invalid; historical cards '
      + 'retain only a "Plugin removed" record. Do not call this Tool when versions must remain available for restart '
      + 'or rollback; use cordis_stop instead.',
    parameters: {
      pluginId: { type: 'string', required: true, description: 'Stable dynamic Plugin ID to remove permanently.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          pluginId: { type: 'string', required: true },
          wasRunning: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Removed dynamic Plugin ${value.pluginId} and all of its Packages.` }],
    },
    async execute(args, exec) {
      const receipt = await ctx.dynamicCordisRunner.undefine(requireAgent(exec), CordisDynamicPluginId(args.pluginId))
      if (!receipt.ok) throw new Error(receipt.message)
      return { pluginId: args.pluginId, wasRunning: receipt.wasRunning }
    },
    presentCall: presentUndefineCall,
  }))

  ctx.on('agent/pre-step', async ({ agent, messages, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    const ids = referencedPluginIds(messages)
    if (ids.length === 0) return decision
    signal.throwIfAborted()
    const contexts = ids.map((id) => {
      const reference = ctx.dynamicCordisRunner.reference(agent, CordisDynamicPluginId(id))
      return createUserMessage({
        content: [{
          type: 'text',
          text: reference === undefined ? renderUnavailableReference(id) : renderReference(reference),
        }],
        source: { kind: 'plugin', plugin: name, form: 'instructions' },
      })
    })
    return { kind: 'enter', messages: [...decision.messages, ...contexts] }
  })
}

function requireJsonObject(value: JsonValue): Record<string, JsonValue> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('expected a JSON object')
  }
  return value
}

function requireJsonString(value: Record<string, JsonValue>, key: string): string {
  const field = value[key]
  if (typeof field !== 'string') throw new Error(`expected JSON string field "${key}"`)
  return field
}

type SelfState = 'defined' | 'awaiting-approval' | 'client-pending' | 'stopped' | 'running' | 'waiting' | 'failed'

function selfSummary(reference: DynamicCordisReference & { packages?: readonly unknown[] }): Record<string, JsonValue> {
  const latest = reference.latestRun
  const state = selfState(reference)
  return {
    pluginId: String(reference.pluginId),
    name: reference.name,
    packageCount: reference.packages?.length ?? 1,
    state,
    ...reference.currentPackageId === undefined ? {} : { currentPackageId: String(reference.currentPackageId) },
    ...reference.nextPackageId === undefined ? {} : { nextPackageId: String(reference.nextPackageId) },
    ...reference.activeRun === undefined ? {} : {
      activeRun: {
        pluginRunId: String(reference.activeRun.pluginRunId),
        packageId: String(reference.activeRun.packageId),
      },
    },
    ...latest?.status !== 'awaiting-approval' ? {} : {
      pendingApproval: {
        pluginRunId: String(latest.pluginRunId),
        packageId: String(latest.packageId),
        mode: latest.mode,
      },
    },
  }
}

function selfState(reference: DynamicCordisReference): SelfState {
  const status = reference.latestRun?.status
  if (status === 'awaiting-approval') return 'awaiting-approval'
  if (status === 'client-pending' || status === 'starting-host') return 'client-pending'
  if (status === 'failed' || status === 'rejected' || status === 'cancelled') return 'failed'
  if (status === 'waiting') return 'waiting'
  if (status === 'running') return 'running'
  if (reference.activeRun !== undefined) return 'running'
  return reference.currentPackageId === undefined ? 'defined' : 'stopped'
}

function inspectSelfPackage(
  ctx: Context,
  agent: Agent,
  pluginId: ReturnType<typeof CordisDynamicPluginId>,
  packageId: ReturnType<typeof CordisDynamicPackageId>,
): Record<string, JsonValue> {
  const inspected = ctx.dynamicCordisRunner.inspectPackage(agent, pluginId, packageId)
  const row = ctx.dynamicCordisRunner.snapshot(agent).find(candidate => candidate.pluginId === pluginId)
  const pkg = row?.packages.find(candidate => candidate.packageId === packageId)
  const active = row?.activeRun?.packageId === packageId ? row.activeRun : undefined
  const latest = inspected.latestRun?.packageId === packageId ? inspected.latestRun : undefined
  const hostWaiting = active?.fiber === undefined ? [...(latest?.host.waitingFor ?? [])] : missingServices(ctx, active.fiber)
  const hostStatus = pkg?.hasHostHalf !== true
    ? 'absent'
    : latest?.host.status ?? (active === undefined ? 'stopped' : hostWaiting.length === 0 ? 'running' : 'waiting')
  const clientStatus = pkg?.hasClientHalf !== true
    ? 'absent'
    : latest?.client.status ?? 'stopped'
  return {
    mode: 'package',
    plugin: selfSummary(inspected),
    packageId: String(packageId),
    name: inspected.name,
    purpose: inspected.purpose,
    code: inspected.code,
    runtime: {
      state: selfState(inspected),
      host: {
        status: hostStatus,
        provides: active?.fiber === undefined ? [] : providedServices(ctx, active.fiber),
        waitingFor: hostWaiting,
        handlers: active?.handlers ?? [],
        ...latest?.host.error === undefined ? {} : { error: latest.host.error },
      },
      client: {
        status: clientStatus,
        waitingFor: [...(latest?.client.waitingFor ?? [])],
        ...latest?.client.error === undefined ? {} : { error: latest.client.error },
        ...active?.renderFailure === undefined ? {} : { renderFailure: active.renderFailure },
      },
    },
  } as unknown as Record<string, JsonValue>
}

function referencedPluginIds(messages: readonly UserMessage[]): string[] {
  const found = new Set<string>()
  const pattern = /(?:^|\s)@([a-z]{3,6}-\d+)(?=\s|$)/g
  for (const message of messages) {
    if (message.source.kind !== 'user') continue
    const text = message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
    for (const match of text.matchAll(pattern)) if (match[1] !== undefined) found.add(match[1])
  }
  return [...found]
}

function renderReference(reference: ReturnType<Context['dynamicCordisRunner']['reference']> & {}): string {
  const mode = reference.currentPackageId === undefined ? 'run' : 'update'
  return [
    '<cordis_dynamic_plugin_context>',
    JSON.stringify(reference, null, 2),
    '',
    `The user explicitly referenced @${reference.pluginId}. Use Package ${reference.packageId} as the base for this modification.`,
    `Before modifying it, call cordis_inspect_self with pluginId="${reference.pluginId}" and packageId="${reference.packageId}" to read the exact metadata and source.`,
    `Use cordis_define with plugin.kind="existing" and the original pluginId="${reference.pluginId}" to append an immutable Package.`,
    `Do not create a new Plugin for this request. After cordis_define succeeds, call cordis_run mode="${mode}" with the returned packageId.`,
    '</cordis_dynamic_plugin_context>',
  ].join('\n')
}

function renderUnavailableReference(id: string): string {
  return [
    '<cordis_dynamic_plugin_context>',
    `The user explicitly referenced @${id}, but this Plugin is unavailable in the current Session.`,
    'It may have been removed, belong to another Session, or have been lost when the DSH process restarted.',
    'Do not claim that it was updated or silently create a replacement Plugin. Tell the user that the reference is currently unavailable.',
    '</cordis_dynamic_plugin_context>',
  ].join('\n')
}
