import { mkdtemp, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import {
  launchAcpTestAgent,
  type AgentUnderTest,
  type LaunchedAcpTestAgent,
} from '@deepseek-ai/dsh-acp-snapshot'
import { cleanupAcpExampleTest } from './cleanup.ts'

/**
 * With-key e2e for the Claude hook bridge. The process-level `./hooks.json` is
 * resolved from a temporary launch cwd and blocks all PreToolUse calls; a real
 * model is asked to write there, and absence of the file proves interception.
 * The test owns and disposes the ACP subprocess.
 */

const AGENT: AgentUnderTest = {
  binScript: fileURLToPath(new URL('../../../packages/examples/acp-demo/src/bin.ts', import.meta.url)),
  configPath: fileURLToPath(new URL('../cordis.yml', import.meta.url)),
  tsconfigPath: fileURLToPath(new URL('../../../tsconfig.json', import.meta.url)),
}

let spawned: LaunchedAcpTestAgent | undefined
let workdir: string | undefined

afterEach(async () => {
  const ownedSpawned = spawned
  const ownedWorkdir = workdir
  spawned = undefined
  workdir = undefined
  await cleanupAcpExampleTest(ownedSpawned, ownedWorkdir)
})

describe.skipIf(!process.env.DEEPSEEK_API_KEY)('acp-agent e2e: a PreToolUse hook blocks bash (real model)', () => {
  it('denies every bash command, so the requested file is never written (verified on disk)', async () => {
    workdir = await mkdtemp(join(tmpdir(), 'acp-hooks-e2e-'))
    // `configPath` is process-relative, so placing the match-all hook in the
    // launch cwd selects it; hook commands themselves run in the session cwd.
    await writeFile(join(workdir, 'hooks.json'), JSON.stringify({
      hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'echo "bash blocked by policy" >&2; exit 2' }] }] },
    }))

    spawned = launchAcpTestAgent({
      agent: AGENT,
      cwd: workdir,
      env: { DSH_PERMISSION_MODE: 'danger-full-access' },
    })
    const { client, updates } = spawned

    await client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const { sessionId } = await client.newSession({ cwd: workdir, mcpServers: [] })

    const res = await client.prompt({
      sessionId,
      prompt: [{ type: 'text', text: 'Use the bash tool to write the exact text HOOK_FAIL into a file named proof.txt in the current directory. Then stop.' }],
    })
    // The turn completes normally (the block is a tool-result error fed back to
    // the model, not a turn failure).
    expect(['end_turn', 'max_tokens']).toContain(res.stopReason)

    // Assert the denied operation independently of the model response.
    await expect(access(join(workdir, 'proof.txt'))).rejects.toThrow()

    // ACP publishes only the committed answer; hook/tool trace stays in the session log.
    expect(updates.length).toBeGreaterThan(0)
    expect(updates.every(update => update.sessionUpdate === 'agent_message_chunk')).toBe(true)
  }, 180_000)
})
