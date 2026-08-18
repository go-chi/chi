/**
 * Settings/credentials/llm RPC domains and their host-stream frames over
 * createApiProxy: layered redacted describe, write-path rejection mapping,
 * value-free credential views, the directory/live-route merge, and the three
 * invalidation frames (settings/credentials/models changed).
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmModelInfo, LlmProviderInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SettingsProvider, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { CredentialInfo, CredentialRef, ResolvedCredential } from '@deepseek-ai/dsh-credentials'
import type { HostFrame } from '../src/api/index.ts'
import type { RpcRequest, RpcResponse } from '../src/api/rpc.ts'
import { RpcId } from '../src/api/rpc.ts'
import { AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE } from '@deepseek-ai/dsh-agent-default-model'
import { createApiProxy } from '../src/api-proxy.ts'

const DEFAULTS = { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' }

let nextRpc = 1
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`req-${String(nextRpc++)}`), payload }
}

function expectOk<T>(response: RpcResponse<T>): T {
  expect(response.result.ok).toBe(true)
  if (!response.result.ok) throw new Error('unreachable')
  return response.result.value
}

function expectErr<T>(response: RpcResponse<T>): { code: string; message: string; details: unknown } {
  expect(response.result.ok).toBe(false)
  if (response.result.ok) throw new Error('unreachable')
  return response.result.error
}

/** In-memory settings provider: the Service Definition base class owns all tested behavior. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown>

  constructor(ctx: ConstructorParameters<typeof SettingsProvider>[0], options?: {
    doc?: Record<string, unknown>
    readOnly?: boolean
    documentPath?: string
    preparedPath?: string
  }) {
    super(ctx)
    this.doc = structuredClone(options?.doc ?? {})
    this.readOnly = options?.readOnly ?? false
    this.path = options?.documentPath
    this.preparedPath = options?.preparedPath
  }

  private readonly readOnly: boolean
  private readonly path: string | undefined
  private readonly preparedPath: string | undefined

  get writable(): boolean {
    return !this.readOnly
  }

  override get documentPath(): string | undefined {
    return this.path
  }

  override prepareDocument(): Promise<string | undefined> {
    return Promise.resolve(this.preparedPath ?? this.documentPath)
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc[ns] = structuredClone(section)
    return Promise.resolve()
  }
}

/** In-memory credential provider with an env-shadow double for the rejection path. */
class MemoryCredentials extends CredentialProvider {
  private readonly values = new Map<string, string>()

  constructor(ctx: ConstructorParameters<typeof CredentialProvider>[0], options?: { shadowed?: string[] }) {
    super(ctx)
    this.shadowed = new Set(options?.shadowed ?? [])
  }

  private readonly shadowed: Set<string>

  resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    if (this.shadowed.has(ref)) return Promise.resolve({ value: 'from-env', source: 'env' })
    const value = this.values.get(ref)
    return Promise.resolve(value === undefined ? undefined : { value, source: 'file' })
  }

  describe(ref: CredentialRef): Promise<CredentialInfo> {
    if (this.shadowed.has(ref)) return Promise.resolve({ configured: true, source: 'env', writable: false })
    const configured = this.values.has(ref)
    return Promise.resolve({ configured, ...configured ? { source: 'file' } : {}, writable: true })
  }

  set(ref: CredentialRef, value: string): Promise<void> {
    if (this.shadowed.has(ref)) {
      return Promise.reject(new Error(`credentials: ${ref} is shadowed by the read-only environment`))
    }
    this.values.set(ref, value)
    this.ctx.emit('credentials/updated', ref)
    return Promise.resolve()
  }

  unset(ref: CredentialRef): Promise<void> {
    if (this.shadowed.has(ref)) {
      return Promise.reject(new Error(`credentials: ${ref} is shadowed by the read-only environment`))
    }
    this.values.delete(ref)
    this.ctx.emit('credentials/updated', ref)
    return Promise.resolve()
  }
}

/** Catalog-serving adapter stub for the llm.models path. */
class CatalogAdapter extends LlmAdapter {
  constructor(private readonly name: string, private readonly models: readonly string[]) {
    super()
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: this.name }
  }

  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve(this.models.map(id => ({ provider, id, name: id })))
  }


  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    throw new Error('not exercised')
  }
}

class BrokenCatalogAdapter extends CatalogAdapter {
  override listModels(): Promise<readonly LlmModelInfo[]> {
    return Promise.reject(new Error('catalog backend down'))
  }
}

const NS = settingsNamespace('llm-deepseek')

const AdapterConfig = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().default('DEEPSEEK_API_KEY'),
  baseURL: z.string(),
})

async function harness(options?: {
  settings?: false | {
    doc?: Record<string, unknown>
    readOnly?: boolean
    documentPath?: string
    preparedPath?: string
  }
  credentials?: false | { shadowed?: string[] }
  /** Skip the directory registration to exercise a namespace the proxy does not expose. */
  configurableProviders?: false
}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(LlmRuntime)
  if (options?.settings !== false) await ctx.plugin(MemorySettings, options?.settings)
  if (options?.credentials !== false) await ctx.plugin(MemoryCredentials, options?.credentials)
  // Model-provider namespaces plus the explicit Web preference and product
  // onboarding allowlists are the proxy's complete settings surface.
  if (options?.configurableProviders !== false) {
    ctx.llm.registerConfigurableProviders([
      { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] },
    ])
  }
  // Host-stream opener reads the committed-workspace baseline; the stub
  // suffices — the real workspace composition is api-proxy-workspace.spec's.
  ctx.provide('workspaceRegistry', { list: () => [] } as never)
  return ctx
}

/** Drain `count` host frames matching `types`, then abort the stream. */
async function collectHost(
  api: ReturnType<typeof createApiProxy>,
  types: string[],
  count: number,
  run: () => Promise<void>,
): Promise<HostFrame[]> {
  const abort = new AbortController()
  const frames: HostFrame[] = []
  const stream = api.events.host(request({}), abort.signal)
  const consume = (async () => {
    for await (const frame of stream) {
      if (!types.includes(frame.payload.type)) continue
      frames.push(frame.payload)
      if (frames.length >= count) abort.abort()
    }
  })()
  await run()
  await consume
  return frames
}

/**
 * One forwarded `settings/document-updated` frame for `ns`. The revision rides
 * the host's own argument list, so it is matched by shape rather than pinned to
 * a per-test count.
 * @param ns - the namespace whose stored section changed.
 * @returns the expected wrapper frame.
 */
function forwardedSettings(ns: string): HostFrame {
  return {
    type: 'host/remote-event',
    event: 'settings/document-updated',
    // The revision is the Host's own counter, so the matcher is the assertion.
    args: [ns, expect.any(Number)], // oxlint-disable-line typescript/no-unsafe-assignment
  }
}

describe('settings domain', () => {
  it('reports an actionable error when no settings provider is mounted', async () => {
    const ctx = await harness({ settings: false })
    const api = createApiProxy(ctx, DEFAULTS)
    const error = expectErr(await api.settings.describe(request({})))
    expect(error.code).toBe('internal')
    expect(error.message).toContain('dsh-settings-file')
  })

  it('describes layered redacted namespaces with their secret slots', async () => {
    const ctx = await harness({ settings: {
      doc: { 'llm-deepseek': { apiKey: 'user-secret', baseURL: 'https://user' } },
      documentPath: '/tmp/custom-settings.yaml',
    } })
    ctx.settings.register(NS, AdapterConfig, { base: { baseURL: 'https://base' } })
    const api = createApiProxy(ctx, DEFAULTS)
    const value = expectOk(await api.settings.describe(request({})))
    expect(value.writable).toBe(true)
    expect(value.hasDocument).toBe(true)
    expect(value.namespaces).toHaveLength(1)
    const view = value.namespaces[0]!
    expect(view.ns).toBe('llm-deepseek')
    expect(view.applies).toBe('live')
    expect((view.schema as { refs?: unknown }).refs).toBeDefined()
    expect(view.value).toEqual({ apiKeyEnv: 'DEEPSEEK_API_KEY', baseURL: 'https://user' })
    expect(view.base).toEqual({ baseURL: 'https://base' })
    expect(view.user).toEqual({ baseURL: 'https://user' })
    expect(view.secrets).toEqual([{ path: ['apiKey'], set: true }])
    expect(JSON.stringify(value)).not.toContain('user-secret')
  })

  it('opens the provider-resolved document without accepting a browser path', async () => {
    const ctx = await harness({ settings: {
      documentPath: '/tmp/described-settings.yaml',
      preparedPath: '/tmp/custom-settings.yaml',
    } })
    const opened: string[] = []
    const api = createApiProxy(ctx, {
      ...DEFAULTS,
      openTextFile: (path) => {
        opened.push(path)
        return Promise.resolve()
      },
    })

    expect(expectOk(await api.settings.openDocument(request({}), new AbortController().signal)))
      .toEqual({ opened: true })
    expect(opened).toEqual(['/tmp/custom-settings.yaml'])
  })

  it('refuses to open settings when the provider has no local document', async () => {
    const ctx = await harness()
    const api = createApiProxy(ctx, DEFAULTS)
    expect(expectOk(await api.settings.describe(request({}))).hasDocument).toBe(false)
    const error = expectErr(await api.settings.openDocument(request({}), new AbortController().signal))
    expect(error.code).toBe('internal')
    expect(error.message).toContain('no local document')
  })

  it('does not prepare or open a settings document after cancellation', async () => {
    const ctx = await harness({ settings: { documentPath: '/tmp/settings.yaml' } })
    const opened: string[] = []
    const api = createApiProxy(ctx, {
      ...DEFAULTS,
      openTextFile: (path) => {
        opened.push(path)
        return Promise.resolve()
      },
    })
    const prepare = vi.spyOn(ctx.settings, 'prepareDocument')
    const cancelled = new AbortController()
    cancelled.abort()
    expect(expectErr(await api.settings.openDocument(request({}), cancelled.signal)).code)
      .toBe('cancelled')
    expect(prepare).not.toHaveBeenCalled()

    const pending = Promise.withResolvers<string | undefined>()
    prepare.mockReturnValueOnce(pending.promise)
    const duringPrepare = new AbortController()
    const opening = api.settings.openDocument(request({}), duringPrepare.signal)
    await vi.waitFor(() => { expect(prepare).toHaveBeenCalledOnce() })
    duringPrepare.abort()
    pending.resolve('/tmp/settings.yaml')
    expect(expectErr(await opening).code).toBe('cancelled')
    expect(opened).toEqual([])
  })

  it('serves every registered namespace, including one this repository never named', async () => {
    // Registering IS the exposure: a plugin distributed outside this
    // repository configures itself from the browser without a change here.
    // The plane stays loopback-only and secret-redacted, and which surface
    // renders a namespace is the browser's decision, not this proxy's.
    const ctx = await harness()
    ctx.settings.register(NS, AdapterConfig)
    ctx.settings.register(settingsNamespace('some-other-plugin'), z.object({ secretPath: z.string() }))
    ctx.settings.register(settingsNamespace('permission'), z.object({
      defaultPreset: z.union(['read-only', 'workspace-write']).required(),
    }), {
      base: { defaultPreset: 'read-only' },
    })
    ctx.settings.register(settingsNamespace('ui-theme'), z.object({
      preference: z.union(['light', 'dark', 'system']).default('system'),
    }))
    ctx.settings.register(settingsNamespace('locale'), z.object({
      preference: z.union(['zh', 'en']).required(false),
    }))
    ctx.settings.register(settingsNamespace('ui-conversation'), z.object({
      busyEnter: z.union(['queue', 'steer']).default('queue'),
    }))
    ctx.settings.register(settingsNamespace('shell'), z.object({
      timeoutMs: z.number().default(120_000),
    }))
    ctx.settings.register(settingsNamespace('agent-loop'), z.object({
      maxParallelToolCalls: z.number().default(10),
    }))
    ctx.settings.register(settingsNamespace('web-search-deepseek'), z.object({
      baseURL: z.string(),
    }))
    const api = createApiProxy(ctx, DEFAULTS)

    const value = expectOk(await api.settings.describe(request({})))
    expect(value.namespaces.map(view => view.ns)).toEqual([
      'llm-deepseek', 'some-other-plugin', 'permission', 'ui-theme', 'locale',
      'ui-conversation', 'shell', 'agent-loop', 'web-search-deepseek',
    ])
    const permission = expectOk(await api.settings.mutate(request({
      ns: 'permission',
      ops: [{ op: 'set', path: ['defaultPreset'], value: 'workspace-write' }],
    })))
    expect(permission.value).toEqual({ defaultPreset: 'workspace-write' })
    const theme = expectOk(await api.settings.mutate(request({
      ns: 'ui-theme',
      ops: [{ op: 'set', path: ['preference'], value: 'dark' }],
    })))
    expect(theme.value).toEqual({ preference: 'dark' })
    const locale = expectOk(await api.settings.mutate(request({
      ns: 'locale',
      ops: [{ op: 'set', path: ['preference'], value: 'en' }],
    })))
    expect(locale.value).toEqual({ preference: 'en' })
    const conversation = expectOk(await api.settings.mutate(request({
      ns: 'ui-conversation',
      ops: [{ op: 'set', path: ['busyEnter'], value: 'steer' }],
    })))
    expect(conversation.value).toEqual({ busyEnter: 'steer' })
    const bash = expectOk(await api.settings.mutate(request({
      ns: 'shell',
      ops: [{ op: 'set', path: ['timeoutMs'], value: 5_000 }],
    })))
    expect(bash.value).toEqual({ timeoutMs: 5_000 })
    const agentLoop = expectOk(await api.settings.mutate(request({
      ns: 'agent-loop',
      ops: [{ op: 'set', path: ['maxParallelToolCalls'], value: 2 }],
    })))
    expect(agentLoop.value).toEqual({ maxParallelToolCalls: 2 })
    const webSearch = expectOk(await api.settings.mutate(request({
      ns: 'web-search-deepseek',
      ops: [{ op: 'set', path: ['baseURL'], value: 'https://search.test/v1' }],
    })))
    expect(webSearch.value).toEqual({ baseURL: 'https://search.test/v1' })

    const other = expectOk(await api.settings.update(request({
      ns: 'some-other-plugin',
      patch: { secretPath: '/etc/shadow' },
    })))
    expect(other.value).toEqual({ secretPath: '/etc/shadow' })
    expect(ctx.settings.describe().find(d => String(d.ns) === 'some-other-plugin')?.value)
      .toEqual({ secretPath: '/etc/shadow' })
  })

  it('serves product preference namespaces without invalidating the model catalog', async () => {
    const ctx = await harness()
    ctx.settings.register(settingsNamespace('ui-onboarding'), z.object({ welcomeNoticeVersion: z.string() }))
    ctx.settings.register(settingsNamespace('ui-theme'), z.object({
      preference: z.union(['light', 'dark', 'system']).default('system'),
    }))
    const api = createApiProxy(ctx, DEFAULTS)
    expect(expectOk(await api.settings.describe(request({}))).namespaces.map(view => view.ns))
      .toEqual(['ui-onboarding', 'ui-theme'])
    const frames = await collectHost(api, ['host/remote-event'], 2, async () => {
      expectOk(await api.settings.mutate(request({
        ns: 'ui-onboarding',
        ops: [{ op: 'set', path: ['welcomeNoticeVersion'], value: 'v1' }],
      })))
      expectOk(await api.settings.mutate(request({
        ns: 'ui-theme',
        ops: [{ op: 'set', path: ['preference'], value: 'dark' }],
      })))
    })
    expect(frames).toEqual([forwardedSettings('ui-onboarding'), forwardedSettings('ui-theme')])
  })

  it('serves the agent-preset namespace, so a browser preset picker can persist its choice', async () => {
    const ctx = await harness()
    ctx.settings.register(settingsNamespace('agent-presets'), z.object({ default: z.string() }))
    const api = createApiProxy(ctx, DEFAULTS)

    expectOk(await api.settings.update(request({ ns: 'agent-presets', patch: { default: 'minimal' } })))

    // Both browser surfaces that offer the choice — the General row and the
    // management section — write the default through `settings.update`, so a
    // namespace outside this boundary makes the picker move and then silently
    // forget, which is worse than refusing the control.
    expect(ctx.settings.describe().find(view => String(view.ns) === 'agent-presets')?.value)
      .toEqual({ default: 'minimal' })
  })

  it('keeps serving a provider namespace whose directory entry is gone', async () => {
    // The configurable-provider directory says what the Models page can offer,
    // not what a user may configure: a dormant route's stored section is still
    // theirs to edit, and losing the entry must not strand it.
    const ctx = await harness({ configurableProviders: false })
    ctx.settings.register(NS, AdapterConfig)
    const api = createApiProxy(ctx, DEFAULTS)
    expect(expectOk(await api.settings.describe(request({}))).namespaces.map(view => view.ns))
      .toEqual(['llm-deepseek'])
    expect(expectOk(await api.settings.update(request({ ns: 'llm-deepseek', patch: { baseURL: 'https://x' } }))).value)
      .toMatchObject({ baseURL: 'https://x' })
  })

  it('forwards a provider settings change for model-catalog consumers', async () => {
    // Editing `models` changes no route, so llm/adapters-updated never fires
    // and an open model picker would keep serving the stale catalog. Storing
    // an override equal to the resolved value emits nothing on
    // settings/updated, so another tab would never learn the field became
    // overridden.
    const ctx = await harness()
    ctx.settings.register(NS, AdapterConfig, { base: { baseURL: 'https://base' } })
    const api = createApiProxy(ctx, DEFAULTS)
    const frames = await collectHost(api, ['host/remote-event'], 1, async () => {
      await api.settings.update(request({ ns: 'llm-deepseek', patch: { baseURL: 'https://base' } }))
    })
    expect(frames).toEqual([forwardedSettings('llm-deepseek')])
    // The resolved value never moved: base already said https://base.
    expect(expectOk(await api.settings.describe(request({}))).namespaces[0]!.value)
      .toEqual({ apiKeyEnv: 'DEEPSEEK_API_KEY', baseURL: 'https://base' })
  })

  it('broadcasts a permission change without invalidating the model catalog', async () => {
    const ctx = await harness()
    const permission = ctx.settings.register(settingsNamespace('permission'), z.object({
      defaultPreset: z.union(['read-only', 'workspace-write']).required(),
    }), {
      base: { defaultPreset: 'read-only' },
    })
    const api = createApiProxy(ctx, DEFAULTS)
    const frames = await collectHost(api, ['host/remote-event'], 1, async () => {
      await permission.update({ defaultPreset: 'workspace-write' })
    })
    expect(frames).toEqual([forwardedSettings('permission')])
  })

  it('forwards an Agent-default settings change for model-catalog consumers', async () => {
    const ctx = await harness()
    const defaultModel = ctx.settings.register(AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE, z.object({
      provider: z.string().required(),
      model: z.string().required(),
    }), { base: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } })
    const api = createApiProxy(ctx, DEFAULTS)
    // The shared section names the selection every blank session resolves to,
    // so an externally edited default — another tab, a
    // hand-edited settings.yaml — has to reach an open selector as well.
    const frames = await collectHost(api, ['host/remote-event'], 1, async () => {
      await defaultModel.replace({ provider: 'deepseek-official', model: 'deepseek-reasoner' })
    })
    expect(frames).toEqual([forwardedSettings('agent-default-model')])
  })

  it('maps a stale expectedRevision to settings-conflict carrying both revisions', async () => {
    const ctx = await harness()
    ctx.settings.register(NS, AdapterConfig)
    const api = createApiProxy(ctx, DEFAULTS)
    const opened = expectOk(await api.settings.describe(request({}))).namespaces[0]!.revision
    expect(expectOk(await api.settings.update(request({ ns: 'llm-deepseek', patch: { baseURL: 'https://first' }, expectedRevision: opened })))
      .revision).toBe(opened + 1)
    const error = expectErr(await api.settings.update(request({ ns: 'llm-deepseek', patch: { baseURL: 'https://second' }, expectedRevision: opened })))
    expect(error.code).toBe('settings-conflict')
    expect(error.details).toEqual({ ns: 'llm-deepseek', expected: opened, actual: opened + 1 })
    // The refused write changed nothing.
    expect(expectOk(await api.settings.describe(request({}))).namespaces[0]!.user).toEqual({ baseURL: 'https://first' })
  })

  it('updates the user layer, answers with the new redacted view, and broadcasts the frame', async () => {
    const ctx = await harness()
    ctx.settings.register(NS, AdapterConfig, { base: { baseURL: 'https://base' } })
    const api = createApiProxy(ctx, DEFAULTS)
    const frames = await collectHost(api, ['host/remote-event'], 1, async () => {
      const view = expectOk(await api.settings.update(request({ ns: 'llm-deepseek', patch: { apiKey: 'sk-new', baseURL: 'https://next' } })))
      expect(view.value).toEqual({ apiKeyEnv: 'DEEPSEEK_API_KEY', baseURL: 'https://next' })
      expect(view.user).toEqual({ baseURL: 'https://next' })
      expect(view.secrets).toEqual([{ path: ['apiKey'], set: true }])
      expect(JSON.stringify(view)).not.toContain('sk-new')
    })
    expect(frames).toEqual([forwardedSettings('llm-deepseek')])
  })

  it('replace resets the user layer wholesale', async () => {
    const ctx = await harness({ settings: { doc: { 'llm-deepseek': { baseURL: 'https://user' } } } })
    ctx.settings.register(NS, AdapterConfig)
    const api = createApiProxy(ctx, DEFAULTS)
    const view = expectOk(await api.settings.replace(request({ ns: 'llm-deepseek', section: {} })))
    expect(view.value).toEqual({ apiKeyEnv: 'DEEPSEEK_API_KEY' })
    expect(view.user).toEqual({})
  })

  it.each([
    ['an invalid namespace name', 'Not A Namespace', {}],
    ['a schema-invalid patch', 'llm-deepseek', { baseURL: 42 }],
  ])('rejects %s as settings-rejected', async (_case, ns, patch) => {
    const ctx = await harness()
    ctx.settings.register(NS, AdapterConfig)
    const api = createApiProxy(ctx, DEFAULTS)
    const error = expectErr(await api.settings.update(request({ ns, patch })))
    expect(error.code).toBe('settings-rejected')
    expect(error.details).toEqual({ ns })
  })

  it('answers an unregistered namespace as the seam does, and a malformed one alike', async () => {
    // A name no registration answers and a name no registration could answer
    // fold into the same rejection: the proxy adds no boundary of its own, so
    // the seam's own refusal is the whole answer.
    const ctx = await harness()
    ctx.settings.register(NS, AdapterConfig)
    const api = createApiProxy(ctx, DEFAULTS)
    const unknown = expectErr(await api.settings.update(request({ ns: 'unknown-ns', patch: {} })))
    const malformed = expectErr(await api.settings.update(request({ ns: 'Not A Namespace', patch: {} })))
    expect(unknown.code).toBe('settings-rejected')
    expect(unknown.message).toContain('is not registered')
    expect(malformed.code).toBe(unknown.code)
  })

  it('maps a read-only provider refusal onto the same rejection', async () => {
    const ctx = await harness({ settings: { readOnly: true } })
    ctx.settings.register(NS, AdapterConfig)
    const api = createApiProxy(ctx, DEFAULTS)
    const value = expectOk(await api.settings.describe(request({})))
    expect(value.writable).toBe(false)
    const error = expectErr(await api.settings.update(request({ ns: 'llm-deepseek', patch: {} })))
    expect(error.code).toBe('settings-rejected')
    expect(error.message).toContain('read-only')
  })
})

describe('credentials domain', () => {
  it('reports an actionable error when no credential provider is mounted', async () => {
    const ctx = await harness({ credentials: false })
    const api = createApiProxy(ctx, DEFAULTS)
    const error = expectErr(await api.credentials.describe(request({ refs: ['A'] })))
    expect(error.code).toBe('internal')
    expect(error.message).toContain('dsh-credentials-local')
  })

  it('describes value-free views and flips state through set/unset with frames', async () => {
    const ctx = await harness()
    const api = createApiProxy(ctx, DEFAULTS)
    const before = expectOk(await api.credentials.describe(request({ refs: ['OPENAI_API_KEY'] })))
    expect(before.credentials).toEqual({ OPENAI_API_KEY: { configured: false, writable: true } })
    const frames = await collectHost(api, ['host/remote-event'], 2, async () => {
      expectOk(await api.credentials.set(request({ ref: 'OPENAI_API_KEY', value: 'sk-secret' })))
      const after = expectOk(await api.credentials.describe(request({ refs: ['OPENAI_API_KEY'] })))
      expect(after.credentials).toEqual({ OPENAI_API_KEY: { configured: true, source: 'file', writable: true } })
      expect(JSON.stringify(after)).not.toContain('sk-secret')
      expectOk(await api.credentials.unset(request({ ref: 'OPENAI_API_KEY' })))
    })
    expect(frames).toEqual([
      { type: 'host/remote-event', event: 'credentials/updated', args: ['OPENAI_API_KEY'] },
      { type: 'host/remote-event', event: 'credentials/updated', args: ['OPENAI_API_KEY'] },
    ])
  })

  it('maps a shadowed write onto credential-rejected for set and unset alike', async () => {
    const ctx = await harness({ credentials: { shadowed: ['DEEPSEEK_API_KEY'] } })
    const api = createApiProxy(ctx, DEFAULTS)
    const described = expectOk(await api.credentials.describe(request({ refs: ['DEEPSEEK_API_KEY'] })))
    expect(described.credentials['DEEPSEEK_API_KEY']).toEqual({ configured: true, source: 'env', writable: false })
    const setError = expectErr(await api.credentials.set(request({ ref: 'DEEPSEEK_API_KEY', value: 'x' })))
    expect(setError.code).toBe('credential-rejected')
    expect(setError.details).toEqual({ ref: 'DEEPSEEK_API_KEY' })
    const unsetError = expectErr(await api.credentials.unset(request({ ref: 'DEEPSEEK_API_KEY' })))
    expect(unsetError.code).toBe('credential-rejected')
  })
})

describe('llm domain', () => {
  it('merges the configurable directory with live routes and appends undeclared ones', async () => {
    const ctx = await harness({ configurableProviders: false })
    ctx.llm.registerConfigurableProviders([
      { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] },
      { provider: 'openai', displayName: 'openai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'] },
    ])
    ctx.llm.registerAdapter(['deepseek-official'], new CatalogAdapter('DeepSeek', ['deepseek-v4-flash']))
    ctx.llm.registerAdapter(['undeclared'], new CatalogAdapter('Undeclared', ['u-1']))
    // Only one namespace can answer an interrogation, so the flag follows the
    // entry's namespace rather than being assumed for every row.
    ctx.llm.registerModelDiscovery('llm-pi-ai', () => Promise.resolve([]))
    const api = createApiProxy(ctx, DEFAULTS)
    const value = expectOk(await api.llm.providers(request({})))
    expect(value.providers).toEqual([
      { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [], active: true },
      { provider: 'openai', displayName: 'openai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'], active: false },
      // An undeclared live route has no settings address, so nothing can be
      // interrogated on its behalf either.
      { provider: 'undeclared', displayName: 'Undeclared', settingsNs: '', settingsPath: [], active: true },
    ])
  })

  it('serves the host-scoped catalog with per-provider failures contained', async () => {
    const ctx = await harness()
    ctx.llm.registerAdapter(['deepseek-official'], new CatalogAdapter('DeepSeek', ['deepseek-v4-flash', 'deepseek-v4-pro']))
    ctx.llm.registerAdapter(['broken'], new BrokenCatalogAdapter('Broken', []))
    const api = createApiProxy(ctx, DEFAULTS)
    const value = expectOk(await api.llm.models(request({})))
    expect(value.groups).toEqual([{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [
        { id: 'deepseek-v4-flash', name: 'deepseek-v4-flash' },
        { id: 'deepseek-v4-pro', name: 'deepseek-v4-pro' },
      ],
    }])
    expect(value.failures).toEqual([{ id: 'broken', name: 'Broken', message: 'catalog backend down' }])
  })

  it('forwards llm/adapters-updated at every topology commit point', async () => {
    const ctx = await harness()
    const api = createApiProxy(ctx, DEFAULTS)
    const frames = await collectHost(api, ['host/remote-event'], 2, async () => {
      const dispose = ctx.llm.registerAdapter(['deepseek-official'], new CatalogAdapter('DeepSeek', []))
      dispose()
      return Promise.resolve()
    })
    expect(frames).toEqual([
      { type: 'host/remote-event', event: 'llm/adapters-updated', args: [] },
      { type: 'host/remote-event', event: 'llm/adapters-updated', args: [] },
    ])
  })
})

describe('llm.discoverModels', () => {
  it('carries a draft to its namespace and returns candidates without storing anything', async () => {
    const ctx = await harness()
    const seen: unknown[] = []
    ctx.llm.registerModelDiscovery('llm-pi-ai', (probe) => {
      seen.push({ baseURL: probe.baseURL, api: probe.api, apiKey: probe.apiKey })
      return Promise.resolve([
        { id: 'acme-large', name: 'Acme Large', contextWindow: 65_536, maxTokens: 4096 },
        { id: 'acme-small' },
      ])
    })
    const api = createApiProxy(ctx, DEFAULTS)

    const value = expectOk(await api.llm.discoverModels(request({
      settingsNs: 'llm-pi-ai',
      baseURL: 'https://gateway.acme.example/v1',
      api: 'openai-completions',
      apiKey: 'probe-key',
    })))

    expect(value.models).toEqual([
      { id: 'acme-large', name: 'Acme Large', contextWindow: 65_536, maxTokens: 4096 },
      { id: 'acme-small' },
    ])
    expect(seen).toEqual([{
      baseURL: 'https://gateway.acme.example/v1',
      api: 'openai-completions',
      apiKey: 'probe-key',
    }])
    // Interrogating a draft is a read: no namespace gained a section, and no
    // credential reference was written.
    expect(expectOk(await api.settings.describe(request({}))).namespaces.map(view => view.ns))
      .not.toContain('llm-pi-ai')
  })

  it('carries the route being edited so an adapter can answer from its own registry', async () => {
    const ctx = await harness()
    let probe: unknown
    ctx.llm.registerModelDiscovery('llm-pi-ai', (request_) => {
      probe = request_
      return Promise.resolve([{ id: 'from-registry', contextWindow: 65_536, maxTokens: 4096 }])
    })
    const api = createApiProxy(ctx, DEFAULTS)

    const value = expectOk(await api.llm.discoverModels(request({
      settingsNs: 'llm-pi-ai',
      provider: 'deepseek',
    })))

    // No endpoint at all: a route the adapter already describes needs none.
    expect(probe).toEqual({ provider: 'deepseek' })
    expect(value.models).toEqual([{ id: 'from-registry', contextWindow: 65_536, maxTokens: 4096 }])
  })

  it('omits a credential and protocol the draft does not name', async () => {
    const ctx = await harness()
    let probe: unknown
    ctx.llm.registerModelDiscovery('llm-pi-ai', (request_) => {
      probe = request_
      return Promise.resolve([])
    })
    const api = createApiProxy(ctx, DEFAULTS)

    expectOk(await api.llm.discoverModels(request({
      settingsNs: 'llm-pi-ai',
      baseURL: 'https://gateway.acme.example/v1',
    })))

    // Absent fields stay absent rather than crossing as explicit undefined:
    // the adapter distinguishes "no protocol named" from "protocol undefined".
    expect(probe).toEqual({ baseURL: 'https://gateway.acme.example/v1' })
  })

  it('reports a failed interrogation as the form\'s next move, naming no credential', async () => {
    const ctx = await harness()
    ctx.llm.registerModelDiscovery('llm-pi-ai', () =>
      Promise.reject(new Error('https://gateway.acme.example/v1/models answered 401; check the API key')))
    const api = createApiProxy(ctx, DEFAULTS)

    const error = expectErr(await api.llm.discoverModels(request({
      settingsNs: 'llm-pi-ai',
      baseURL: 'https://gateway.acme.example/v1',
      apiKey: 'wrong',
    })))

    expect(error.code).toBe('model-discovery-failed')
    expect(error.message).toContain('answered 401; check the API key')
    expect(error.details).toEqual({ settingsNs: 'llm-pi-ai', baseURL: 'https://gateway.acme.example/v1' })
    expect(JSON.stringify(error)).not.toContain('wrong')
  })

  it('reports a namespace no adapter family serves', async () => {
    const ctx = await harness()
    const api = createApiProxy(ctx, DEFAULTS)

    const error = expectErr(await api.llm.discoverModels(request({
      settingsNs: 'llm-deepseek',
      baseURL: 'https://api.deepseek.com',
    })))

    expect(error.code).toBe('model-discovery-failed')
    expect(error.message).toContain('no model discovery is registered')
  })
})
