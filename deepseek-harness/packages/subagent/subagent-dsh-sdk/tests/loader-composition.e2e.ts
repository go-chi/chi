/**
 * Keyless REAL-composition coverage for parent-session cwd inheritance across
 * the SDK wire: a test-only cordis.yml boots the headless app through the
 * Loader with the SDK backend's `cwd` omitted, a scripted model delegates
 * once, and the child — a COMPLETE second harness runtime booted from its own
 * cordis.yml and driven over stdio JSON-RPC — echoes where it actually ran.
 * Both the parent's tool result and the child's own persisted session log
 * must carry the parent session's cwd. Mock-only composition, so only this
 * keyless tier applies (the with-key tier lives in subagent-sdk.e2e.ts).
 */

import { realpathSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { type SessionEvent } from '@deepseek-ai/dsh-session'
import { resolveExampleLaunch, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const fixtureDir = new URL('../../../../examples/jsonrpc-agent/tests/fixtures/subagent/subagent-dsh-sdk/', import.meta.url)
const driver = fileURLToPath(new URL('driver.ts', fixtureDir))
const configPath = fileURLToPath(new URL('cordis.yml', fixtureDir))
const childConfigPath = fileURLToPath(new URL('child.cordis.yml', fixtureDir))
const runtimeBin = fileURLToPath(new URL('../../../../packages/examples/jsonrpc-demo/src/bin.ts', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

async function jsonlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const paths = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return jsonlFiles(path)
    return entry.isFile() && entry.name.endsWith('.jsonl') ? [path] : []
  }))
  return paths.flat()
}

async function sessionEvents(log: string): Promise<SessionEvent[]> {
  const lines = (await readFile(log, 'utf8')).trimEnd().split('\n')
  return lines.slice(1).map(line => JSON.parse(line) as SessionEvent)
}

describe('SDK subagent cwd inheritance through a real cordis.yml', () => {
  it('runs the child runtime in the parent session workspace', async () => {
    // The child launch honors the same src/lib mode as the driving harness,
    // per the shared example-launch resolver (testing policy forbids
    // hand-written `--import tsx` argv for example subprocesses).
    const childLaunch = resolveExampleLaunch({
      srcBin: runtimeBin,
      configArgs: [childConfigPath],
      tsconfigPath: repoTsconfig,
    })

    let events: SessionEvent[] = []
    let childEvents: SessionEvent[] = []
    let workspace = ''
    const { stderr } = await runLoaderSmoke({
      label: 'dsh-sdk-subagent cwd composition smoke',
      tempDirPrefix: 'dsh-sdk-subagent-cwd-e2e-',
      binScript: driver,
      libBinScript: driver,
      configPath,
      tsconfigPath: repoTsconfig,
      // Two complete harness runtimes boot in sequence (driver, then the SDK
      // child); from-source tsx boots under load need more than the default
      // 30s window.
      processTimeoutMs: 120_000,
      env: {
        DSH_TEST_CHILD_COMMAND: childLaunch.command,
        DSH_TEST_CHILD_ARGS: JSON.stringify(childLaunch.args),
        DSH_TEST_CHILD_ENV: JSON.stringify({
          ...Object.fromEntries(Object.entries(childLaunch.env).filter(([, value]) => value !== undefined)),
        }),
      },
      inspect: async (cwd) => {
        // The child reports realpaths; canonicalize the temp workspace to match.
        workspace = realpathSync(cwd)
        const parentLogs = await jsonlFiles(join(cwd, '.sessions'))
        expect(parentLogs).toHaveLength(1)
        events = await sessionEvents(parentLogs[0] as string)
        // The child runtime persisted its own transcript in ITS cwd — which
        // must be the parent session's workspace for the inheritance to hold.
        const childLogs = await jsonlFiles(join(cwd, '.child-sessions'))
        expect(childLogs).toHaveLength(1)
        childEvents = await sessionEvents(childLogs[0] as string)
      },
    })
    expect(stderr).not.toContain('UNHANDLED')

    // The parent's tool result carries the child model's echo of its real
    // process.cwd() — the parent session's workspace, never the harness
    // process's launch directory.
    const results = events.filter(event => event.type === 'tool/result')
    expect(results).toHaveLength(1)
    const resultText = results[0]!.data.message.content[0].content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
    expect(resultText).toBe(`child cwd: ${workspace}`)

    // The child ran a real turn of its own: user message in, assistant out.
    expect(childEvents.some(event => event.type === 'user/message')).toBe(true)
    const childAnswers = childEvents.filter(event => event.type === 'assistant/message')
    expect(childAnswers.length).toBeGreaterThan(0)
    // 15s of vitest headroom past the subprocess deadline, mirroring
    // LOADER_SMOKE_TEST_TIMEOUT_MS's margin over the default window.
  }, 135_000)
})
