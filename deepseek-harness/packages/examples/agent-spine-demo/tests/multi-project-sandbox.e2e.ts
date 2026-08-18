import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SandboxBashExecutor } from '@deepseek-ai/dsh-bash-sandbox'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import * as FsPolicy from '@deepseek-ai/dsh-fs-observation-policy'
import SandboxedFileSystem from '@deepseek-ai/dsh-fs-sandbox'
import { CallId } from '@deepseek-ai/dsh-llm'
import { LocalSandboxProvider } from '@deepseek-ai/dsh-sandbox-local'
import { seatbeltProfileArgs } from '@deepseek-ai/dsh-sandbox-local/src/profiles.ts'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import type { ToolResult } from '@deepseek-ai/dsh-tools'
import { launcherPath } from '@deepseek-ai/node-addon-landlock-run'
import * as agentSpine from '../src/index.ts'

const bwrapUsable = spawnSync('bwrap', [
  '--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--die-with-parent', '--', 'true',
], { timeout: 5_000, stdio: 'ignore' }).status === 0
const landlockUsable = spawnSync(launcherPath(), ['--probe'], { timeout: 5_000, stdio: 'ignore' }).status === 0
const seatbeltUsable = process.platform === 'darwin'
  && spawnSync('sandbox-exec', [...seatbeltProfileArgs({ mode: 'workspace-write', workspaceRoot: homedir() }), '--', 'true'], { timeout: 5_000, stdio: 'ignore' }).status === 0
const processSandboxUsable = bwrapUsable || landlockUsable || seatbeltUsable

let ctx: Context | undefined
let projectA: string
let projectB: string
const tempDirs: string[] = []

async function projectDir(label: string): Promise<string> {
  const dir = await mkdtemp(join(homedir(), `dsh-${label}-`))
  tempDirs.push(dir)
  return dir
}

async function expectMissing(path: string): Promise<void> {
  await expect(readFile(path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
}

function resultText(result: ToolResult): string {
  return result.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
}

beforeEach(async () => {
  projectA = await projectDir('project-a')
  projectB = await projectDir('project-b')
  const fallbackRoot = await projectDir('fallback')

  ctx = new Context()
  await ctx.plugin(LocalSandboxProvider, {})
  await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: fallbackRoot })
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(SandboxBashExecutor, { cwd: fallbackRoot, timeoutMs: 30_000 })
  await ctx.plugin(SandboxedFileSystem, { cwd: fallbackRoot })
  await ctx.plugin(agentSpine, {
    workspaceContext: false,
    skills: { enabled: false },
    toolBash: { enableRunInBackground: false },
    toolJobs: false,
  })
  await new Promise(resolve => setTimeout(resolve, 50))
  await ctx.plugin(FsPolicy)
  await ctx.plugin(ToolFs)
})

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function agents() {
  const active = ctx as Context
  const [a, b] = await Promise.all([
    active.agents.create({ sessionId: SessionId('project-a-session'), meta: { cwd: projectA } }),
    active.agents.create({ sessionId: SessionId('project-b-session'), meta: { cwd: projectB } }),
  ])
  return { active, agentA: a.agent, agentB: b.agent }
}

describe('one-context multi-project sandbox', () => {
  it.skipIf(!processSandboxUsable)('confines concurrent bash calls to each calling session workspace', async () => {
    const { active, agentA, agentB } = await agents()
    const [aOwn, bOwn, aCross, bCross] = await Promise.all([
      active.tools.execute({
        callId: CallId('bash-a-own'), name: 'bash', agent: agentA,
        signal: new AbortController().signal,
        arguments: { command: 'printf a > a-owned.txt', description: 'Write project A marker' },
      }),
      active.tools.execute({
        callId: CallId('bash-b-own'), name: 'bash', agent: agentB,
        signal: new AbortController().signal,
        arguments: { command: 'printf b > b-owned.txt', description: 'Write project B marker' },
      }),
      active.tools.execute({
        callId: CallId('bash-a-cross'), name: 'bash', agent: agentA,
        signal: new AbortController().signal,
        arguments: { command: `printf cross > ../${basename(projectB)}/from-a.txt`, description: 'Attempt project B write' },
      }),
      active.tools.execute({
        callId: CallId('bash-b-cross'), name: 'bash', agent: agentB,
        signal: new AbortController().signal,
        arguments: { command: `printf cross > ../${basename(projectA)}/from-b.txt`, description: 'Attempt project A write' },
      }),
    ])

    expect(aOwn.isError).toBe(false)
    expect(bOwn.isError).toBe(false)
    expect(aCross.isError).toBe(false)
    expect(bCross.isError).toBe(false)
    expect(resultText(aCross)).toContain('[sandbox: file access denied under workspace-write mode]')
    expect(resultText(bCross)).toContain('[sandbox: file access denied under workspace-write mode]')
    expect(await readFile(join(projectA, 'a-owned.txt'), 'utf8')).toBe('a')
    expect(await readFile(join(projectB, 'b-owned.txt'), 'utf8')).toBe('b')
    await expectMissing(join(projectB, 'from-a.txt'))
    await expectMissing(join(projectA, 'from-b.txt'))
  })

  it('confines concurrent filesystem writes to each calling session workspace', async () => {
    const { active, agentA, agentB } = await agents()
    const [aOwn, bOwn, aCross, bCross] = await Promise.all([
      active.tools.execute({
        callId: CallId('fs-a-own'), name: 'write', agent: agentA,
        signal: new AbortController().signal,
        arguments: { file_path: 'a-owned.txt', content: 'a' },
      }),
      active.tools.execute({
        callId: CallId('fs-b-own'), name: 'write', agent: agentB,
        signal: new AbortController().signal,
        arguments: { file_path: 'b-owned.txt', content: 'b' },
      }),
      active.tools.execute({
        callId: CallId('fs-a-cross'), name: 'write', agent: agentA,
        signal: new AbortController().signal,
        arguments: { file_path: join(projectB, 'from-a.txt'), content: 'cross' },
      }),
      active.tools.execute({
        callId: CallId('fs-b-cross'), name: 'write', agent: agentB,
        signal: new AbortController().signal,
        arguments: { file_path: join(projectA, 'from-b.txt'), content: 'cross' },
      }),
    ])

    expect(aOwn.isError).toBe(false)
    expect(bOwn.isError).toBe(false)
    expect(aCross.isError).toBe(true)
    expect(bCross.isError).toBe(true)
    expect(resultText(aCross)).toContain('[sandbox: file access denied under workspace-write mode]')
    expect(resultText(bCross)).toContain('[sandbox: file access denied under workspace-write mode]')
    expect(await readFile(join(projectA, 'a-owned.txt'), 'utf8')).toBe('a')
    expect(await readFile(join(projectB, 'b-owned.txt'), 'utf8')).toBe('b')
    await expectMissing(join(projectB, 'from-a.txt'))
    await expectMissing(join(projectA, 'from-b.txt'))
  })

  it.skipIf(!processSandboxUsable)('keeps symlink-sensitive session cwd semantics aligned across bash, fs, and policy', async () => {
    const active = ctx as Context
    const lexicalRoot = await projectDir('lexical-workspace')
    const physicalRoot = await projectDir('physical-workspace')
    const physicalChild = join(physicalRoot, 'child')
    await mkdir(physicalChild)
    const link = join(lexicalRoot, 'link')
    await symlink(physicalChild, link, process.platform === 'win32' ? 'junction' : 'dir')
    const sessionCwd = `${link}/..`
    const handle = await active.agents.create({
      sessionId: SessionId('symlink-parent-session'),
      meta: { cwd: sessionCwd },
    })

    const [bashOwn, bashLexical, fsOwn, fsLexical] = await Promise.all([
      active.tools.execute({
        callId: CallId('bash-symlink-own'), name: 'bash', agent: handle.agent,
        signal: new AbortController().signal,
        arguments: { command: 'printf bash > bash-owned.txt', description: 'Write physical workspace marker' },
      }),
      active.tools.execute({
        callId: CallId('bash-symlink-lexical'), name: 'bash', agent: handle.agent,
        signal: new AbortController().signal,
        arguments: { command: `printf escaped > ${join(lexicalRoot, 'bash-escaped.txt')}`, description: 'Attempt lexical workspace write' },
      }),
      active.tools.execute({
        callId: CallId('fs-symlink-own'), name: 'write', agent: handle.agent,
        signal: new AbortController().signal,
        arguments: { file_path: 'fs-owned.txt', content: 'fs' },
      }),
      active.tools.execute({
        callId: CallId('fs-symlink-lexical'), name: 'write', agent: handle.agent,
        signal: new AbortController().signal,
        arguments: { file_path: join(lexicalRoot, 'fs-escaped.txt'), content: 'escaped' },
      }),
    ])

    expect(bashOwn.isError).toBe(false)
    expect(resultText(bashOwn)).not.toContain('[sandbox:')
    expect(bashLexical.isError).toBe(false)
    expect(resultText(bashLexical)).toContain('[sandbox: file access denied under workspace-write mode]')
    expect(fsOwn.isError).toBe(false)
    expect(fsLexical.isError).toBe(true)
    expect(resultText(fsLexical)).toContain('[sandbox: file access denied under workspace-write mode]')
    expect(await readFile(join(physicalRoot, 'bash-owned.txt'), 'utf8')).toBe('bash')
    expect(await readFile(join(physicalRoot, 'fs-owned.txt'), 'utf8')).toBe('fs')
    await expectMissing(join(lexicalRoot, 'bash-escaped.txt'))
    await expectMissing(join(lexicalRoot, 'fs-escaped.txt'))
  })

  it.skipIf(!processSandboxUsable)('resolves parent traversal from a symlinked session root consistently', async () => {
    const active = ctx as Context
    const lexicalRoot = await projectDir('lexical-parent')
    const physicalRoot = await projectDir('physical-parent')
    const physicalChild = join(physicalRoot, 'child')
    await mkdir(physicalChild)
    const link = join(lexicalRoot, 'link')
    await symlink(physicalChild, link, process.platform === 'win32' ? 'junction' : 'dir')
    await writeFile(join(lexicalRoot, 'shared.txt'), 'from-lexical-parent')
    await writeFile(join(physicalRoot, 'shared.txt'), 'from-physical-parent')
    const handle = await active.agents.create({
      sessionId: SessionId('symlink-root-parent-path-session'),
      meta: { cwd: link },
    })

    const [bashRead, fsRead] = await Promise.all([
      active.tools.execute({
        callId: CallId('bash-symlink-parent-read'), name: 'bash', agent: handle.agent,
        signal: new AbortController().signal,
        arguments: { command: 'cat ../shared.txt', description: 'Read through the physical parent' },
      }),
      active.tools.execute({
        callId: CallId('fs-symlink-parent-read'), name: 'read', agent: handle.agent,
        signal: new AbortController().signal,
        arguments: { file_path: '../shared.txt' },
      }),
    ])

    expect(bashRead.isError).toBe(false)
    expect(fsRead.isError).toBe(false)
    expect(resultText(bashRead)).toContain('from-physical-parent')
    expect(resultText(fsRead)).toContain('from-physical-parent')
    expect(resultText(bashRead)).not.toContain('from-lexical-parent')
    expect(resultText(fsRead)).not.toContain('from-lexical-parent')
  })
})
