import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readdir, rm, symlink, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Agent as AcpAgent,
  type Client,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
} from '@agentclientprotocol/sdk'
import { Readable, Writable } from 'node:stream'
import { promisify } from 'node:util'
import { zstdDecompress } from 'node:zlib'
import { execa } from 'execa'
import { afterEach, describe, expect, it } from 'vitest'

/**
 * Published-entry smoke: run `lib/bin.js` under plain Node in a symlinked external consumer and
 * complete a mock-backed turn. This catches built-only settle races, stdout protocol leaks, and
 * published persistence behavior that the tsx source-path smoke cannot. It skips before build.
 */

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const acpBin = join(repoRoot, 'packages/examples/acp-demo/lib/bin.js')
const decompress = promisify(zstdDecompress)

const dshPackages = [
  'examples/agent-spine-demo', 'core/agent', 'core/session', 'core/system-prompt',
  'core/tools', 'core/agent-loop', 'llm/llm', 'shell/shell',
  'shell/bash-local', 'shell/tool-bash', 'subprocess/subprocess', 'subprocess/subprocess-local', 'context/agent-instructions', 'runtime-diagnostics/invariants', 'boot/app-boot',
  'session/session-persistence',
  'session/session-checkpoint-policy', 'session/session-persistence-jsonl',
  'acp/acp', 'examples/acp-demo', 'util/home-paths',
]
const vendorPackages = [
  'cordis', 'loader', 'include', 'timer', 'hmr', 'logger-console',
  'schemastery', 'cosmokit',
]
// Resolve ACP's declared third-party dependencies from that package, not this test: pnpm's strict
// layout need not hoist them. Symlink those exact paths into the plain-Node consumer.
const npmDeps = ['@agentclientprotocol/sdk']
const acpPkgDir = join(repoRoot, 'packages/acp/acp')

async function pkgName(absDir: string): Promise<string> {
  const json = JSON.parse(await readFile(join(absDir, 'package.json'), 'utf8')) as { name: string }
  return json.name
}

async function link(target: string, name: string, nm: string): Promise<void> {
  const dest = join(nm, name)
  await mkdir(dirname(dest), { recursive: true })
  await symlink(target, dest)
}

/** Build a temp consumer dir + a minimal acp `cordis.yml`. Returns the dir. */
async function makeConsumer(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'acp-built-bin-'))
  const nm = join(dir, 'node_modules')
  for (const rel of dshPackages) {
    const abs = join(repoRoot, 'packages', rel)
    await link(abs, await pkgName(abs), nm)
  }
  for (const v of vendorPackages) {
    const abs = join(repoRoot, 'vendor', v)
    await link(abs, await pkgName(abs), nm)
  }
  for (const dep of npmDeps) {
    // Resolve from ACP's package.json URL (the package that declares the
    // dep), not this test file's location — `acp-agent` does not depend on these.
    const fromAcp = pathToFileURL(join(acpPkgDir, 'package.json')).href
    const resolved = fileURLToPath(import.meta.resolve(`${dep}/package.json`, fromAcp))
    await link(dirname(resolved), dep, nm)
  }
  await writeFile(join(dir, 'mock-llm.mjs'), [
    "import { LlmAdapter } from '@deepseek-ai/dsh-llm'",
    'class Mock extends LlmAdapter {',
    '  async * stream() {',
    "    yield { type: 'block-start', index: 0, blockType: 'text' }",
    "    yield { type: 'text-delta', index: 0, text: 'ACP BUILT OK' }",
    "    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'ACP BUILT OK' } }",
    "    yield { type: 'finish', reason: { kind: 'stop' } }",
    '  }',
    '}',
    "export const name = 'built-acp-mock'",
    "export const inject = ['llm']",
    "export function apply(ctx) { ctx.llm.registerAdapter(['built-acp-mock'], new Mock()) }",
    '',
  ].join('\n'))
  await writeFile(join(dir, 'cordis.yml'), [
    '- id: mock-llm',
    '  name: \'./mock-llm.mjs\'',
    '- id: subprocess',
    '  name: \'@deepseek-ai/dsh-subprocess-local\'',
    '- id: bash',
    '  name: \'@deepseek-ai/dsh-bash-local\'',
    '- id: acp-agent',
    '  name: \'@deepseek-ai/dsh-acp-demo\'',
    '  config:',
    '    provider: built-acp-mock',
    '    model: built-acp-mock',
    '    persona: \'test agent\'',
    '    workspaceContext: false',
    '',
  ].join('\n'))
  return dir
}

let consumer: string | undefined
let child: ReturnType<typeof spawn> | undefined

afterEach(async () => {
  if (child !== undefined) {
    const proc = child
    child = undefined
    // Windows retains the child's cwd and session-log handles until process
    // teardown completes, so await exit before removing the temp directory.
    if (proc.exitCode === null && proc.signalCode === null) {
      const exited = new Promise<void>((resolve) => { proc.once('exit', () => { resolve() }) })
      proc.kill('SIGKILL')
      await exited
    }
  }
  // Windows can briefly retain released handles after exit; retry removal.
  if (consumer !== undefined) await rm(consumer, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  consumer = undefined
})

describe.skipIf(!existsSync(acpBin))('dsh-acp-demo BUILT bin (node lib/bin.js, no tsx)', () => {
  it('boots the published bin, completes a turn, and writes default Zstandard persistence', async () => {
    consumer = await makeConsumer()
    child = spawn(process.execPath, [acpBin, '--config', './cordis.yml'], {
      cwd: consumer,
      env: {
        ...process.env,
        DSH_HOME: join(consumer, '.dsh'),
        DSH_AGENTS_HOME: join(consumer, '.agents'),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const stderr: string[] = []
    child.stderr!.setEncoding('utf8')
    child.stderr!.on('data', (c: string) => stderr.push(c))
    // Tee raw stdout for a protocol-purity check, and feed it to the SDK client.
    const rawOut: string[] = []
    const passthrough = new Readable({ read() {} })
    child.stdout!.on('data', (buf: Buffer) => { rawOut.push(buf.toString('utf8')); passthrough.push(buf) })
    child.stdout!.on('end', () => passthrough.push(null))
    const stream = ndJsonStream(
      Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>,
      Readable.toWeb(passthrough) as ReadableStream<Uint8Array>,
    )
    const updates: SessionNotification['update'][] = []
    const makeClient = (_a: AcpAgent): Client => ({
      sessionUpdate(params: SessionNotification): Promise<void> {
        updates.push(params.update)
        return Promise.resolve()
      },
      requestPermission(_p: RequestPermissionRequest): Promise<RequestPermissionResponse> {
        return Promise.resolve({ outcome: { outcome: 'cancelled' } })
      },
    })
    const client = new ClientSideConnection(makeClient, stream)

    const init = await client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    expect(init.agentCapabilities).toEqual({
      promptCapabilities: { image: false, audio: false, embeddedContext: false },
    })
    const sessionCwd = consumer
    const { sessionId } = await client.newSession({ cwd: sessionCwd, mcpServers: [] })
    const result = await client.prompt({ sessionId, prompt: [{ type: 'text', text: 'reply' }] })
    expect(result.stopReason).toBe('end_turn')
    await expect.poll(() => updates).toEqual([{
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'ACP BUILT OK' },
    }])
    const sessionsRoot = join(sessionCwd, '.sessions')
    let log: string | undefined
    await expect.poll(async () => {
      log = (await readdir(sessionsRoot, { recursive: true })).find(file => file.endsWith('.jsonl.zstd'))
      return log
    }).toBeTypeOf('string')
    const compressed = await readFile(join(sessionsRoot, log!))
    expect(compressed.subarray(0, 4).toString('hex')).toBe('28b52ffd')
    expect(JSON.parse((await decompress(compressed)).toString())).toMatchObject({ type: 'session', id: sessionId })
    expect(stderr.join('')).not.toContain('without inject')
    // stdout purity: every emitted line is a JSON-RPC frame, no logger leak.
    for (const line of rawOut.join('').split('\n').filter(l => l.trim().length > 0)) {
      expect(() => JSON.parse(line) as unknown).not.toThrow()
    }
  }, 30_000)

  it('fails LOUD (non-zero exit + stderr) on a config whose directory does not exist', async () => {
    // boot() pre-resolves the bootstrap include to an absolute URL, so a nonexistent config
    // directory cannot break its import; the include plugin's own read must fail loud instead.
    const { code, stderr } = await runBinExpectingExit('/nonexistent/dir/cordis.yml')
    expect(code).not.toBe(0)
    expect(stderr).toContain('config file not found')
  }, 30_000)

  it('fails LOUD (non-zero exit + stderr) on a missing config file in a real directory', async () => {
    // Existing directory plus missing config exercises the include plugin's fail-loud path.
    consumer = await makeConsumer()
    const { code, stderr } = await runBinExpectingExit('./does-not-exist.yml', consumer)
    expect(code).not.toBe(0)
    expect(stderr).toContain('config file not found')
  }, 30_000)

})

/** Spawn the built acp bin against `configArg` (stdin closed at EOF) and resolve with its exit code + stderr. */
async function runBinExpectingExit(configArg: string, cwd: string = tmpdir()): Promise<{ code: number; stderr: string }> {
  const result = await execa(process.execPath, [acpBin, '--config', configArg], {
    cwd,
    env: {
      DSH_HOME: join(cwd, '.dsh'),
      DSH_AGENTS_HOME: join(cwd, '.agents'),
    },
    input: '',
    timeout: 25_000,
    killSignal: 'SIGKILL',
    reject: false,
  })
  if (result.timedOut) throw new Error(`bin did not exit within 25s. stderr:\n${result.stderr}`)
  return { code: result.exitCode ?? -1, stderr: result.stderr }
}
