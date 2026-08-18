// Web e2e scenario: assistant IconActions belong to the settled answer, so
// they arrive with `turn/end` and not before. The recorded turn narrates in
// plain text before its tool call, which is the event order that would show the
// footer beside mid-turn narration for the seconds a tool runs and then move it
// down. A `hang` sidecar on the SECOND model call parks the turn after the
// narration and the tool result are durable, so the running state is stable by
// construction rather than by timing; stopping from that park writes the
// `turn/end` that hands the footer to the turn's transcript tail.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterEach, describe, expect, it, onTestFailed } from 'vitest'
import type { ReplayOverrideDoc } from '@deepseek-ai/dsh-llm-replay'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden, fixtureUserPrompts,
  launchWebScaffold, recordFixture, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/turn-tail-actions', import.meta.url))
const FIXTURE = join(SNAPSHOT_DIR, 'session.jsonl')
// Two goldens for the same message: parked mid-turn, then settled.
const RUNNING_EXPECTED = join(SNAPSHOT_DIR, 'running.expected.md')
const SETTLED_EXPECTED = join(SNAPSHOT_DIR, 'settled.expected.md')
const MODE = webSnapshotMode()

// The recording must carry text in the SAME assistant message as the tool
// call; a Think-only step would leave nothing for the footer to attach to and
// the scenario would pass against either implementation.
const NARRATION = 'Reading the workspace now.'
const PROMPT = `Begin your reply with the plain sentence "${NARRATION}" as text, and in that same message call the bash tool with the command "echo alpha". After the tool result, reply with the single word DONE and stop.`

describe('web e2e: assistant IconActions wait for the turn to end', () => {
  let scaffold: WebScaffold | undefined
  let browser: Browser | undefined
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let sessionEvents: SessionEvent[]
  let sidecarDir: string | undefined

  afterEach(async () => {
    // close() carries the fixture-consumption tripwire, so its failure is the
    // scenario's failure; run every teardown step, then rethrow what failed.
    const failures: unknown[] = []
    await browser?.close().catch((error: unknown) => failures.push(error))
    browser = undefined
    const closing = scaffold
    scaffold = undefined
    await closing?.close().catch((error: unknown) => failures.push(error))
    if (sidecarDir !== undefined) await rm(sidecarDir, { recursive: true, force: true }).catch((error: unknown) => failures.push(error))
    sidecarDir = undefined
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'turn-tail-actions teardown failed')
  })

  /** Boot scaffold + page, materializing the sidecar before the replay row installs. */
  async function launch(buildOverride?: (sidecarHome: string) => ReplayOverrideDoc): Promise<void> {
    sessionEvents = []
    let overridePath: string | undefined
    if (buildOverride !== undefined) {
      sidecarDir = await mkdtemp(join(tmpdir(), 'dsh-web-e2e-sidecar-'))
      overridePath = join(sidecarDir, 'replay.override.json')
      await writeFile(overridePath, JSON.stringify(buildOverride(sidecarDir)))
    }
    scaffold = await launchWebScaffold(
      MODE === 'record'
        ? {}
        : { replayFixture: FIXTURE, ...(overridePath === undefined ? {} : { replayOverride: overridePath }) },
    )
    scaffold.ctx.on('session/event', (_session, event: SessionEvent) => { sessionEvents.push(event) })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }

  /** Send the recorded prompt with the settled barrier pre-armed (returned wrapped so the caller can act mid-turn). */
  async function sendPrompt(timeoutMs?: number): Promise<{ settled: ReturnType<WebScaffold['whenTurnSettled']> }> {
    const input = page.locator('textarea').first()
    await input.waitFor({ timeout: 10_000 })
    const settled = scaffold!.whenTurnSettled(timeoutMs)
    await input.fill(PROMPT)
    await input.press('Enter')
    return { settled }
  }

  it.skipIf(MODE !== 'record')('records the narrate-then-call turn live through the composer', async () => {
    await launch()
    onTestFailed(() => saveFailureShot(page, 'web-e2e-turn-tail-actions-record'))
    const { settled } = await sendPrompt(180_000)
    const sessionId = await settled
    await recordFixture(scaffold!, sessionId, FIXTURE)
  }, 200_000)

  it.skipIf(MODE === 'record')('withholds the footer while the turn runs and grants it at turn/end', async () => {
    expect(fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))).toEqual([PROMPT])
    let marker = ''
    // Patch the SECOND call: the first one delivers the narration and the tool
    // call as recorded, so the park happens with a durable mid-turn message.
    await launch((sidecarHome) => {
      marker = join(sidecarHome, '.hang-ready')
      return { patches: [{ at: 1, entry: { kind: 'hang', readyFile: marker } }] }
    })
    onTestFailed(() => saveFailureShot(page, 'web-e2e-turn-tail-actions'))
    // The barrier is armed before the park and awaited only after the stop
    // click, so its budget must cover the whole parked phase: marker poll,
    // three UI polls, and two captures with their stability windows. The
    // replay default (30s) leaves no headroom on a slow runner.
    const { settled } = await sendPrompt(120_000)
    // The marker IS the synchronization: the second call is provably parked,
    // so the first step's message and tool result are already durable.
    await expect.poll(() => existsSync(marker), { timeout: 20_000 }).toBe(true)
    await expect.poll(() => page.getByText(NARRATION, { exact: true }).count(), { timeout: 10_000 }).toBe(1)
    await expect.poll(
      () => page.getByRole('status').filter({ hasText: 'Deep diving...' }).isVisible(),
      { timeout: 10_000 },
    ).toBe(true)
    // Only the user bubble owns a footer (clock + copy; user bubbles carry no
    // branch action): the narration is not the answer yet.
    const copyButtons = page.getByRole('button', { name: 'Copy' })
    await expect.poll(() => copyButtons.count(), { timeout: 10_000 }).toBe(1)
    expect(await page.getByRole('button', { name: 'Branch into a new conversation' }).count()).toBe(0)
    await copyButtons.first().focus()
    const running = await captureStableAria(page, '[class*="centerCol"]', scaffold!.workspaceCwd)
    await compareOrRefreshGolden(RUNNING_EXPECTED, running, MODE)

    // Closing the turn from the park is the state change under test: an
    // aborted turn is durably closed, so its transcript tail (the frozen
    // partial) takes the seat while the mid-turn narration keeps none.
    await page.getByRole('button', { name: 'Stop generating' }).click()
    await settled
    expect(sessionEvents.filter(e => e.type === 'turn/end').map(e => e.data.reason.kind)).toEqual(['aborted'])
    await expect.poll(() => copyButtons.count(), { timeout: 10_000 }).toBe(2)
    await expect.poll(() => page.locator('[data-streaming="true"]').count(), { timeout: 10_000 }).toBe(0)
    await copyButtons.last().focus()
    const settledAria = await captureStableAria(page, '[class*="centerCol"]', scaffold!.workspaceCwd)
    await compareOrRefreshGolden(SETTLED_EXPECTED, settledAria, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 120_000)

  it.skipIf(MODE === 'record')('keeps a closed fixture inventory', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['running.expected.md', 'session.jsonl', 'settled.expected.md'])
  })
})
