import { describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { renderPrompt, TOOL_ORDER_REST } from '@deepseek-ai/dsh-system-prompt'
import * as agentCore from '../src/index.ts'
import { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import LocalBashExecutor from '@deepseek-ai/dsh-bash-local'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import {
  createUserMessage,
  CallId,
  LlmAdapter,
  LlmError,
  resolveRetryPolicy,
  type GenerateOptions,
  type Message,
  type ResolvedRetryPolicy,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import * as sessionInvariant from '@deepseek-ai/dsh-session/invariant'
import * as agentInvariant from '@deepseek-ai/dsh-agent/invariant'
import * as scopeInvariant from '@deepseek-ai/dsh-scope/invariant'
import * as agentLoopInvariant from '@deepseek-ai/dsh-agent-loop/invariant'

const testToolSignal = new AbortController().signal

declare module '@deepseek-ai/dsh-jobs' {
  interface JobKindMap {
    probe: 'probe'
  }
}

async function composePrefix(ctx: Context, cwd: string): Promise<Message[]> {
  const agent = ctx.agentLoop.create(SessionId('agent-spine-prefix'), {}, { cwd })
  const signal = new AbortController().signal
  const decision = await agentEvents(ctx, agent).waterfall(
    'agent/pre-step', { messages: [], turn: 1, step: 1, signal },
    () => Promise.resolve({ kind: 'enter', messages: [] }),
  )
  if (decision.kind === 'enter') {
    for (const message of decision.messages) {
      agent.session.append('user/message', message, { surfaceOp: 'append' })
    }
  }
  return agent.session.deriveMessages()
}

/**
 * Unit coverage for the @deepseek-ai/dsh-agent-spine-demo bundle: mounting it brings
 * up the whole default spine in one `ctx.plugin`, and the forwarded
 * `agents` config reaches the loop (default `[]`, or a pre-created agent).
 *
 * The bundle is exercised through `ctx.plugin(agentCore, …)` — the NAMESPACE
 * import, the same shape the Loader builds from `unwrapExports`. The real
 * Loader-path guard (export shape, `unwrapExports`) is the app packages' keyless
 * bin smokes; here we assert the composition + config forwarding.
 */
async function mount(config: agentCore.Config, withBash = false): Promise<Context> {
  const oldDshHome = process.env.DSH_HOME
  const oldAgentsHome = process.env.DSH_AGENTS_HOME
  process.env.DSH_HOME = await mkdtemp(join(tmpdir(), 'dsh-agent-spine-demo-home-'))
  process.env.DSH_AGENTS_HOME = await mkdtemp(join(tmpdir(), 'dsh-agent-spine-demo-agents-'))
  const ctx = new Context()
  if (withBash) {
    ctx.provide('shell', {
      sandboxMode: undefined,
      resolve() { throw new Error('composition test does not execute bash') },
      run() { throw new Error('composition test does not execute bash') },
      start() { throw new Error('composition test does not execute bash') },
    })
  }
  try {
    await ctx.plugin(agentCore, config)
    // The bundle mounts its children inside apply() (not awaited there); let their
    // fibers settle so the spine services and any pre-created agent are ready.
    await new Promise(resolve => setTimeout(resolve, 50))
    return ctx
  } finally {
    if (oldDshHome === undefined) {
      delete process.env.DSH_HOME
    } else {
      process.env.DSH_HOME = oldDshHome
    }
    if (oldAgentsHome === undefined) {
      delete process.env.DSH_AGENTS_HOME
    } else {
      process.env.DSH_AGENTS_HOME = oldAgentsHome
    }
  }
}

async function withIsolatedSkillHomes<T>(run: () => Promise<T>): Promise<T> {
  const oldDshHome = process.env.DSH_HOME
  const oldAgentsHome = process.env.DSH_AGENTS_HOME
  process.env.DSH_HOME = await mkdtemp(join(tmpdir(), 'dsh-agent-spine-demo-home-'))
  process.env.DSH_AGENTS_HOME = await mkdtemp(join(tmpdir(), 'dsh-agent-spine-demo-agents-'))
  try {
    return await run()
  } finally {
    if (oldDshHome === undefined) {
      delete process.env.DSH_HOME
    } else {
      process.env.DSH_HOME = oldDshHome
    }
    if (oldAgentsHome === undefined) {
      delete process.env.DSH_AGENTS_HOME
    } else {
      process.env.DSH_AGENTS_HOME = oldAgentsHome
    }
  }
}

function waitForIdle(_ctx: Context, target: Agent): Promise<void> {
  return target.whenIdle()
}

function messageText(message: Message | undefined): string {
  return message?.content.map(block => block.type === 'text' ? block.text : '').join('\n') ?? ''
}

class TransientOnceAdapter extends LlmAdapter {
  requests = 0
  private readonly retryPolicy = resolveRetryPolicy({
    mode: 'normal',
    maxRetries: 1,
    backoff: { initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 },
  }, 'agent-spine test provider retryPolicy')

  override providerRetryPolicy(_provider: string): ResolvedRetryPolicy {
    return this.retryPolicy
  }

  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests += 1
    if (this.requests === 1) throw new LlmError('temporary outage', 'SERVER')
    yield* textResponse('recovered by bundled policy')
  }
}

describe('dsh-agent-spine-demo bundle', () => {
  it('brings up the full default spine', async () => {
    const ctx = await mount({ workspaceContext: false })
    // One service from each layer of the spine proves the children loaded.
    expect(ctx.get('timer')).toBeDefined()
    expect(ctx.get('llm')).toBeDefined()
    expect(ctx.get('sessions')).toBeDefined()
    expect(ctx.get('sessionTitle')).toBeDefined()
    expect(ctx.get('systemPrompt')).toBeDefined()
    expect(ctx.get('tools')).toBeDefined()
    expect(ctx.get('skills')).toBeDefined()
    expect(ctx.get('agents')).toBeDefined()
    expect(ctx.get('jobs')).toBeDefined()
    expect(ctx.get('invariants')).toBeDefined()
    expect(ctx.get('agentLoop')).toBeDefined()
    expect(ctx.get('goals')).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('forwards configurable fallback title limits to the bundled service', async () => {
    const ctx = await mount({
      workspaceContext: false,
      sessionTitle: {
        fallbackMaxWords: 1,
        fallbackMaxBytes: 40,
        maxTitleBytes: 80,
      },
    })
    const session = ctx.sessions.create(SessionId('configured-title-limits'))
    session.append('turn/start', {
      turn: 1,
    })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'One two three four' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(ctx.sessionTitle.get(session)?.title).toBe('One')
    await ctx.fiber.dispose()
  })

  it('opts into the configured persisted-goal domain, tools, and same-session driver', async () => {
    const ctx = await mount({
      workspaceContext: false,
      agents: [{ id: SessionId('configured-goal'), provider: 'mock', model: 'mock' }],
      goals: {
        domain: { defaultMaxGoalRounds: 17 },
        tool: { blockedAfterConsecutiveRounds: 5 },
      },
    })
    const agent = ctx.agents.list()[0]
    if (agent === undefined) throw new Error('configured goal test has no live agent')
    expect(ctx.goals.create(agent, { objective: 'configured' })).toMatchObject({
      objective: 'configured', maxGoalRounds: 17,
    })
    expect(['create_goal', 'get_goal', 'update_goal'].map(name => ctx.tools.get(name)?.name))
      .toEqual(['create_goal', 'get_goal', 'update_goal'])
    expect((await ctx.systemPrompt.assemble()).sections.find(section => section.name === 'tool:goal')?.text)
      .toContain('at least 5 consecutive goal rounds')
    await ctx.fiber.dispose()
  })

  it('accepts an explicit false goal composition without mounting it', async () => {
    const ctx = await mount({ workspaceContext: false, goals: false })
    expect(ctx.get('goals')).toBeUndefined()
    expect(ctx.tools.get('get_goal')).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('mounts package companions and forwards invariant selection config', async () => {
    const nestedTurn = (ctx: Context): void => {
      const session = ctx.sessions.create()
      session.append('turn/start', { turn: 1 })
      session.append('turn/start', { turn: 2 })
    }

    const enabled = await mount({ workspaceContext: false })
    expect(() => { nestedTurn(enabled) }).toThrow(/turn 1 is still open/)
    await enabled.fiber.dispose()

    for (const invariants of [
      { enabled: false },
      { package_allowlist: ['^@deepseek-ai/dsh-agent$'] },
      { package_blocklist: ['^@deepseek-ai/dsh-session$'] },
    ]) {
      const filtered = await mount({ workspaceContext: false, invariants })
      expect(() => { nestedTurn(filtered) }).not.toThrow()
      await filtered.fiber.dispose()
    }
  })

  it('loads and configures bounded request recovery for every bundled entry point', async () => {
    const adapter = new TransientOnceAdapter()
    const ctx = await mount({ workspaceContext: false })
    ctx.llm.registerAdapter(['mock'], adapter)
    const handle = await ctx.agents.create({
      sessionId: SessionId('bundled-retry-session'),
      meta: { cwd: process.cwd() },
      agentOptions: { provider: 'mock', model: 'mock' },
    })

    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'recover' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, handle.agent)

    expect(adapter.requests).toBe(2)
    const retryEvents = handle.agent.session.events.filter(event => event.type === 'llm/retry')
    expect(retryEvents).toHaveLength(1)
    expect(retryEvents[0]?.data.retry).toBe(1)
    expect(retryEvents[0]?.data).toMatchObject({ provider: 'mock', mode: 'normal', maxRetries: 1 })
    expect(handle.agent.session.events.find(event => event.type === 'session/title')?.data.title).toBe('recover')
    expect(messageText(handle.agent.session.deriveMessages().at(-1))).toBe('recovered by bundled policy')
    await handle.dispose()
    await ctx.fiber.dispose()
  })

  it('includes the skill registry, local provider, and skill tool without builtin skills', async () => {
    const ctx = await mount({ workspaceContext: false })

    expect(ctx.skills).toBeDefined()
    expect(ctx.tools.schemas().map(tool => tool.name)).toContain('skill')
    expect(await ctx.skills.list()).toEqual([])

    await ctx.fiber.dispose()
  })

  it('defaults the agents list to empty (no pre-created agents)', async () => {
    const ctx = await mount({ workspaceContext: false })
    expect(ctx.get('agents')?.get(SessionId('main'))).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('forwards a pre-created agent to the loop and the persona to system-prompt', async () => {
    const ctx = await mount({
      agents: [{ id: SessionId('main'), provider: 'mock', model: 'mock' }],
      persona: 'You are main.',
      workspaceContext: false,
    })
    const agent = ctx.get('agents')?.list()[0]
    expect(agent?.id).toBe(agent?.session.id)
    expect(agent?.id).toMatch(/^main-session-/)
    const assembly = await ctx.get('systemPrompt')!.assemble()
    expect(assembly.sections.find(s => s.name === 'deployment:persona')?.text).toBe('You are main.')
    await ctx.fiber.dispose()
  })

  it('forwards the global maxParallelToolCalls config to agent-loop', async () => {
    const ctx = await mount({
      agents: [{ id: SessionId('main'), provider: 'mock', model: 'mock' }],
      maxParallelToolCalls: 3,
      workspaceContext: false,
    })
    expect(ctx.get('agentLoop')?.config.maxParallelToolCalls).toBe(3)
    await ctx.fiber.dispose()
  })

  it('forwards task admission config to the process-local provider', async () => {
    const ctx = await mount({
      jobs: { maxConcurrentJobsPerOwner: 1 },
      workspaceContext: false,
    })
    let settle!: (outcome: { status: 'killed' }) => void
    ctx.jobs.start({
      kind: 'probe',
      label: 'hold configured slot',
      run: () => ({
        cancel: () => { settle({ status: 'killed' }) },
        done: new Promise((resolve) => { settle = resolve }),
      }),
    })
    expect(() => ctx.jobs.start({
      kind: 'probe',
      label: 'blocked configured task',
      run: () => ({ cancel: () => {}, done: Promise.resolve({ status: 'completed' }) }),
    })).toThrow('(limit: 1)')
    await ctx.fiber.dispose()
  })

  it('tolerates a schema-bypassing direct apply (the ?? fallbacks fire)', async () => {
    // ctx.plugin validates + defaults the bundle config first; a direct apply
    // skips the schema, so the forwarding `?? []` / `?? ''` are what fire.
    const ctx = new Context()
    agentCore.apply(ctx, { workspaceContext: false })
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(ctx.get('agentLoop')).toBeDefined()
    expect(ctx.get('agents')?.list()).toHaveLength(0)
    const assembly = await ctx.get('systemPrompt')!.assemble()
    expect(assembly.sections.find(s => s.name === 'deployment:persona')?.text).toBe('')
    await ctx.fiber.dispose()
  })

  it('uses owner defaults for a schema-bypassing empty goal opt-in', async () => {
    const ctx = new Context()
    agentCore.apply(ctx, {
      workspaceContext: false,
      agents: [{ id: SessionId('defaulted-goal'), provider: 'mock', model: 'mock' }],
      goals: {},
    })
    await new Promise(resolve => setTimeout(resolve, 50))
    const agent = ctx.agents.list()[0]
    if (agent === undefined) throw new Error('default goal test has no live agent')
    expect(ctx.goals.create(agent, { objective: 'defaulted' })).toMatchObject({
      objective: 'defaulted', maxGoalRounds: 256,
    })
    expect(ctx.tools.get('get_goal')).toBeDefined()
    await ctx.fiber.dispose()
  })

  it('loads workspace instructions into requests through the bundled spine', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-agent-spine-demo-workspace-context-'))
    try {
      await mkdir(join(root, '.git'), { recursive: true })
      await writeFile(join(root, 'AGENTS.md'), 'bundled project rule')
      const adapter = new MockAdapter([textResponse('first')])
      const ctx = await mount({ workspaceContext: { maxBytes: 65536 } })
      await ctx.plugin(LocalFileSystem, { cwd: '/' })
      ctx.llm.registerAdapter(['mock'], adapter)
      const handle = await ctx.agents.create({
        sessionId: SessionId('main-session'),
        meta: { cwd: root },
        agentOptions: { provider: 'mock', model: 'mock' },
      })
      const agent = handle.agent

      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } }))
      await waitForIdle(ctx, agent)

      expect(adapter.requests).toHaveLength(1)
      const firstRequestText = adapter.requests[0]?.messages.map(messageText).join('\n')
      expect(firstRequestText).toContain('hi')
      expect(firstRequestText).toContain('bundled project rule')
      expect(adapter.requests[0]?.system).toContain('You are an AI agent powered by DeepSeek Harness.')
      expect(adapter.requests[0]?.system).not.toContain('bundled project rule')
      await handle.dispose()
      await ctx.fiber.dispose()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('forwards agent-instructions config to the bundled loader', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-agent-spine-demo-workspace-context-disabled-'))
    try {
      await mkdir(join(root, '.git'), { recursive: true })
      await writeFile(join(root, 'AGENTS.md'), 'must not be injected')
      const adapter = new MockAdapter([textResponse('ok')])
      const ctx = await mount({ workspaceContext: { maxBytes: 0 } })
      ctx.llm.registerAdapter(['mock'], adapter)
      const handle = await ctx.agents.create({
        sessionId: SessionId('main-disabled-session'),
        meta: { cwd: root },
        agentOptions: { provider: 'mock', model: 'mock' },
      })

      handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } }))
      await waitForIdle(ctx, handle.agent)

      expect(adapter.requests[0]?.messages).toEqual([{
        id: expect.any(String) as unknown,
        role: 'user',
        content: [{ type: 'text', text: 'hi' }],
        source: { kind: 'user' },
      }])
      await handle.dispose()
      await ctx.fiber.dispose()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('forwards skill config to the registry, local provider, and model-facing consumer', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-agent-spine-demo-skill-home-'))
    const agentsHome = await mkdtemp(join(tmpdir(), 'dsh-agent-spine-demo-skill-agents-'))
    const custom = await mkdtemp(join(tmpdir(), 'dsh-agent-spine-demo-skill-custom-'))
    await mkdir(custom, { recursive: true })
    await writeFile(join(custom, 'custom-skill.md'), '---\nname: custom-skill\ndescription: Custom skill\n---\n\nCustom body.\n')
    const ctx = await mount({
      agents: [],
      workspaceContext: false,
      skills: {
        registry: { collectCacheMaxEntries: 4 },
        filesystem: {
          dshHome: join(home, '.dsh'),
          agentsHome: join(agentsHome, '.agents'),
          customSkillDirs: [custom],
        },
        tool: { catalogDescriptionMaxLength: 6 },
      },
    })
    expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['custom-skill'])
    expect(JSON.stringify(await composePrefix(ctx, '/tmp'))).toContain('- `custom-skill`: Cus...')
    await ctx.fiber.dispose()
  })

  it('snapshots a created project skill through catalog refresh and progressive loading', { timeout: 15_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-agent-spine-demo-skill-refresh-'))
    const home = await mkdtemp(join(tmpdir(), 'dsh-agent-spine-demo-skill-refresh-home-'))
    try {
      await mkdir(join(root, '.git'), { recursive: true })
      const skillPath = '.agents/skills/hot-skill/SKILL.md'
      const skillSource = '---\nname: hot-skill\ndescription: Hot-added skill\n---\n\nUse the freshly loaded body.\n'
      const adapter = new MockAdapter([
        toolCallResponse('mkdir-skill', 'bash', {
          command: 'mkdir -p .agents/skills/hot-skill',
          description: 'Create the project skill directory',
        }),
        toolCallResponse('write-skill', 'write', {
          file_path: skillPath,
          content: skillSource,
        }),
        toolCallResponse('load-skill', 'skill', { name: 'hot-skill' }),
        textResponse('SKILL_REFRESH_OK'),
      ])
      const ctx = await mount({
        workspaceContext: false,
        skills: {
          filesystem: {
            dshHome: join(home, '.dsh'),
            agentsHome: join(home, '.agents'),
            watchStabilityThresholdMs: 20,
            watchPollIntervalMs: 10,
          },
        },
      })
      await ctx.plugin(LocalBashExecutor, {})
      await ctx.plugin(LocalFileSystem, { cwd: root })
      await ctx.plugin(ToolFs)
      ctx.on('tools/post-execute', async (exec, _result, next) => {
        const decision = await next()
        if (exec.callId === 'write-skill') {
          await vi.waitFor(async () => {
            expect((await ctx.skills.list({ cwd: root })).map(skill => skill.name)).toContain('hot-skill')
          }, { timeout: 5_000 })
        }
        return decision
      })
      ctx.llm.registerAdapter(['mock'], adapter)
      const handle = await ctx.agents.create({
        sessionId: SessionId('skill-refresh-session'),
        meta: { cwd: root },
        agentOptions: { provider: 'mock', model: 'mock' },
      })

      handle.agent.followup(createUserMessage({
        content: [{ type: 'text', text: 'Create and load the project skill.' }],
        source: { kind: 'user' },
      }))
      await waitForIdle(ctx, handle.agent)

      expect(adapter.requests).toHaveLength(4)
      expect(adapter.requests.slice(0, 2).map(request => request.messages.map(messageText).join('\n')))
        .toEqual([
          expect.not.stringContaining('hot-skill'),
          expect.not.stringContaining('hot-skill'),
        ])
      const catalogRequest = adapter.requests[2]?.messages.map(messageText).join('\n')
      expect(catalogRequest).toContain('The following skills are available in this session:')
      expect(catalogRequest).toContain('- `hot-skill`: Hot-added skill')
      const loadedRequest = JSON.stringify(adapter.requests[3]?.messages)
      expect(loadedRequest).toContain('<skill_instructions>')
      expect(loadedRequest).toContain('Use the freshly loaded body.')

      const transcript = handle.agent.session.events.flatMap<Record<string, unknown>>((event) => {
        if (event.type === 'user/message' && event.data.source.kind === 'skill-catalog') {
          return [{
            type: event.type,
            source: event.data.source,
            text: event.data.content.map(block => block.type === 'text' ? block.text : '').join('\n'),
          }]
        }
        if (event.type === 'tool/result'
          && ['write-skill', 'load-skill'].includes(event.data.message.source.callId)) {
          const result = event.data.message.content[0]
          return [{
            type: event.type,
            callId: event.data.message.source.callId,
            isError: result.isError,
            text: result.content.map(block => block.type === 'text' ? block.text : '').join('\n')
              .replaceAll(root, '{{cwd}}')
              .replaceAll(sep, '/'),
          }]
        }
        return []
      })
      expect(transcript).toMatchInlineSnapshot(`
        [
          {
            "callId": "write-skill",
            "isError": false,
            "text": "<path>{{cwd}}/.agents/skills/hot-skill/SKILL.md</path>
        <type>file</type>
        <content>
        Created file
        </content>",
            "type": "tool/result",
          },
          {
            "source": {
              "entries": [
                {
                  "description": "Hot-added skill",
                  "name": "hot-skill",
                },
              ],
              "form": "catalog",
              "kind": "skill-catalog",
            },
            "text": "<system-reminder>
        A skill is a reusable set of task-specific instructions. The following skills are available in this session:

        <available_skills>
        - \`hot-skill\`: Hot-added skill
        </available_skills>

        If the user names a skill, or the task clearly matches a skill's description, call the \`skill\` tool with the exact skill name before taking task actions. Load all applicable skills, then follow their full instructions. This catalog contains summaries only; do not infer or follow a skill's instructions until it has been loaded.
        A user may also invoke a skill directly; its <skill_content> block then appears in this conversation. Follow it, and do not call the \`skill\` tool again for that skill.
        </system-reminder>",
            "type": "user/message",
          },
          {
            "callId": "load-skill",
            "isError": false,
            "text": "<skill_content name="hot-skill">
        <skill_resources>
        Base directory for this skill: {{cwd}}/.agents/skills/hot-skill
        Resolve relative paths mentioned by this skill against the base directory before using them. Load referenced resources only as needed.
        </skill_resources>

        <skill_instructions>
        Use the freshly loaded body.
        </skill_instructions>
        </skill_content>",
            "type": "tool/result",
          },
        ]
      `)

      await handle.dispose()
      await ctx.fiber.dispose()
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(home, { recursive: true, force: true })
    }
  })

  it('shares top-level dshHome between local skills and the managed bash environment', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-agent-core-shared-home-'))
    const agentsHome = await mkdtemp(join(tmpdir(), 'dsh-agent-core-shared-agents-'))
    await mkdir(join(home, 'skills'), { recursive: true })
    await writeFile(join(home, 'skills', 'shared-skill.md'), '---\nname: shared-skill\ndescription: Shared home skill\n---\n\nShared body.\n')

    const ctx = await mount({
      dshHome: home,
      workspaceContext: false,
      skills: { filesystem: { agentsHome } },
    }, true)

    expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['shared-skill'])
    const execution: ToolExecution = {
      signal: testToolSignal,
      token: Symbol('agent-core-dsh-home-test') as ToolExecution['token'],
      callId: CallId('agent-core-dsh-home'),
      rootCallId: CallId('agent-core-dsh-home'),
      name: 'bash',
      arguments: { command: 'true' },
    }
    expect(ctx.shellEnv.collect(execution)).toMatchObject({ DSH_HOME: home, DSH_SHELL: '1' })
    await ctx.fiber.dispose()
  })

  it('rejects conflicting global and nested DSH home directories', () => {
    expect(() => {
      agentCore.apply(new Context(), {
        dshHome: '/global-dsh-home',
        workspaceContext: false,
        skills: { filesystem: { dshHome: '/nested-dsh-home' } },
      })
    }).toThrow('agent-spine-demo: dshHome and skills.filesystem.dshHome must resolve to the same directory')
  })

  it('delivers workspace instructions ahead of the first-step skill catalog', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-agent-spine-demo-prefix-order-'))
    try {
      await mkdir(join(root, '.git'), { recursive: true })
      await writeFile(join(root, 'AGENTS.md'), 'workspace rule before skills')
      const adapter = new MockAdapter([textResponse('first')])
      const ctx = await mount({ workspaceContext: { maxBytes: 65536 } })
      await ctx.plugin(LocalFileSystem, { cwd: '/' })
      ctx.llm.registerAdapter(['mock'], adapter)
      ctx.skills.register({
        name: 'prefix-order-skill',
        description: 'Skill catalog after workspace rules',
        source: 'runtime',
        content: 'body',
      })
      const handle = await ctx.agents.create({
        sessionId: SessionId('prefix-order-session'),
        meta: { cwd: root },
        agentOptions: { provider: 'mock', model: 'mock' },
      })

      handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } }))
      await waitForIdle(ctx, handle.agent)

      expect(adapter.requests).toHaveLength(1)
      const workspaceIndex = adapter.requests[0]!.messages.findIndex(
        message => messageText(message).includes('workspace rule before skills'),
      )
      const catalogIndex = adapter.requests[0]!.messages.findIndex(
        message => messageText(message).includes('prefix-order-skill'),
      )
      expect(workspaceIndex).toBeGreaterThanOrEqual(0)
      expect(catalogIndex).toBeGreaterThanOrEqual(0)
      expect(workspaceIndex).toBeLessThan(catalogIndex)
      await handle.dispose()
      await ctx.fiber.dispose()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('forwards its bundled tool configs to tool-bash and tool-jobs', async () => {
    const ctx = await mount({
      workspaceContext: false,
      toolBash: { enableRunInBackground: false },
      toolJobs: { waitTimeoutMs: 7, maxWaitTimeoutMs: 11 },
    }, true)

    const bash = ctx.tools.schemas().find(tool => tool.name === 'bash')
    expect(bash).toBeDefined()
    expect(Object.keys((bash!.parameters as { properties: Record<string, unknown> }).properties))
      .not.toContain('run_in_background')

    const id = ctx.jobs.start({
      kind: 'probe',
      label: 'config forwarding probe',
      run: () => ({ cancel: () => {}, done: Promise.resolve({ status: 'completed' }) }),
    })
    const wait = vi.spyOn(ctx.jobs, 'wait')
    await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('task-config-forwarding'),
      name: 'job_output',
      arguments: { job_id: id, wait: true },
    })
    expect(wait).toHaveBeenCalledWith(id, 7, undefined, testToolSignal)

    await ctx.fiber.dispose()
  })

  it('can omit skills and model-facing task controls for a foreground-only deployment', async () => {
    const ctx = await mount({
      workspaceContext: false,
      skills: { enabled: false },
      toolBash: { enableRunInBackground: false },
      toolJobs: false,
    }, true)

    expect(ctx.tools.schemas().map(tool => tool.name)).toEqual(['bash'])
    expect(ctx.get('skills')).toBeUndefined()
    expect(ctx.get('jobs')).toBeDefined()

    await ctx.fiber.dispose()
  })

  it('can omit the bundled bash tool and Harness identity for a compatibility deployment', async () => {
    const ctx = await mount({
      includeHarnessIdentity: false,
      includeRuntimeContext: false,
      persona: 'You are a helpful software engineer assistant.',
      workspaceContext: false,
      skills: { enabled: false },
      toolBash: false,
      toolJobs: false,
    }, true)

    expect(ctx.tools.schemas()).toEqual([])
    ctx.systemPrompt.context({ name: 'policy', order: 0, text: 'hidden policy' })
    expect((await ctx.systemPrompt.assemble()).contexts).toEqual([])
    expect(renderPrompt(await ctx.systemPrompt.assemble()))
      .toBe('You are a helpful software engineer assistant.')

    await ctx.fiber.dispose()
  })

  it('picks shared spine config without leaking entry-point fields', () => {
    const appConfig = {
      model: 'entrypoint-only',
      maxParallelToolCalls: 3,
      includeHarnessIdentity: false,
      includeRuntimeContext: false,
      persona: 'You are merged.',
      toolOrder: ['zulu'],
      tools: { mode: 'native' as const },
      dshHome: '/tmp/dsh-home',
      sessionTitle: { fallbackMaxWords: 3, fallbackMaxBytes: 24, maxTitleBytes: 60 },
      workspaceContext: false as const,
      skills: { enabled: false },
      toolBash: { enableRunInBackground: false },
      jobs: { maxConcurrentJobsPerOwner: 4 },
      toolJobs: false as const,
      invariants: { enabled: false },
      goals: false as const,
    }

    expect(agentCore.pickSpineConfig(appConfig)).toEqual({
      maxParallelToolCalls: appConfig.maxParallelToolCalls,
      includeHarnessIdentity: appConfig.includeHarnessIdentity,
      includeRuntimeContext: appConfig.includeRuntimeContext,
      persona: appConfig.persona,
      toolOrder: appConfig.toolOrder,
      tools: appConfig.tools,
      dshHome: appConfig.dshHome,
      sessionTitle: appConfig.sessionTitle,
      workspaceContext: false,
      skills: appConfig.skills,
      toolBash: appConfig.toolBash,
      jobs: appConfig.jobs,
      toolJobs: appConfig.toolJobs,
      invariants: appConfig.invariants,
      goals: appConfig.goals,
    })
    expect(agentCore.pickSpineConfig({ workspaceContext: false })).toEqual({ workspaceContext: false })
  })

  it('uses the default skill config when apply is called directly without skills', async () => {
    await withIsolatedSkillHomes(async () => {
      const ctx = new Context()
      agentCore.apply(ctx, { agents: [], workspaceContext: false })
      await new Promise(resolve => setTimeout(resolve, 50))
      expect(ctx.skills).toBeDefined()
      expect(await ctx.skills.list()).toEqual([])
      await ctx.fiber.dispose()
    })
  })

  it('forwards toolOrder to the system-prompt assembly', async () => {
    const ctx = await mount({ toolOrder: ['zulu', TOOL_ORDER_REST], workspaceContext: false })
    // The bundle's own bash tools pend on the absent `ctx.shell` executor in
    // this providerless mount, so register two plain tools to order.
    for (const name of ['alpha', 'zulu']) {
      ctx.get('tools')!.register({
        name,
        description: name,
        parameters: {},
        output: { schema: { type: 'null' }, render: () => [] },
        execute: async () => null,
      })
    }
    const assembly = await ctx.get('systemPrompt')!.assemble()
    expect(assembly.tools.map(tool => tool.name)).toEqual(['zulu', 'alpha', 'job_kill', 'job_list', 'job_output', 'skill'])
    await ctx.fiber.dispose()
  })

  it('supports direct apply with workspace instructions disabled and no forwarded agents', async () => {
    const ctx = new Context()
    agentCore.apply(ctx, { workspaceContext: false })
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(ctx.get('agents')?.list()).toEqual([])
    expect(ctx.get('systemPrompt')).toBeDefined()
    await ctx.fiber.dispose()
  })

  it('re-exports the loop config schema as its own', () => {
    expect(agentCore.Config).toBeDefined()
    expect(agentCore.name).toBe('agent-spine-demo')
  })

  it('has the namespace-plugin export shape (no stray default) so the Loader keeps name/Config/apply', () => {
    // A default export would make `unwrapExports` collapse this inject-less namespace and silently
    // drop `name`/`Config`. Apps import the bundle directly, so this is its Loader-shape guard.
    expect('default' in agentCore).toBe(false)
    expect(typeof agentCore.apply).toBe('function')

    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(agentCore) as Record<string, unknown>
    expect(unwrapped).toBe(agentCore)
    expect(unwrapped.name).toBe('agent-spine-demo')
    expect(unwrapped.Config).toBeDefined()
    expect(typeof unwrapped.apply).toBe('function')
  })

  it('keeps each standard-spine invariant companion loadable through the real Loader unwrap path', () => {
    const loader = Object.create(Loader.prototype) as Loader
    for (const companion of [sessionInvariant, agentInvariant, scopeInvariant, agentLoopInvariant]) {
      expect('default' in companion).toBe(false)
      const unwrapped = loader.unwrapExports(companion) as Record<string, unknown>
      expect(unwrapped).toBe(companion)
      expect(typeof unwrapped.name).toBe('string')
      expect(unwrapped.inject).toContain('invariants')
      expect(typeof unwrapped.apply).toBe('function')
    }
  })
})
