// Web e2e scenario: a Code Mode round trip. The scaffold boots the SAME
// shipped tree with the tools row patched to mode: code (the run_code-only
// wire), a real chromium sends a prompt engineered to elicit one run_code
// program with several sub-calls, and the UI must render the code-variant
// parent row with its always-visible nested sub-rows — each sub-row the same
// component a native call renders through — plus details-panel resolution for
// a clicked sub-row. Drive steps wait only on generic completion
// (whenTurnSettled); assertion steps run in replay/refresh only.
// Record: DSH_SNAPSHOT=record rewrites session.jsonl, then a keyless
// DSH_SNAPSHOT=refresh regenerates ui.expected.md.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  captureStableAria, compareOrRefreshGolden, fixtureUserPrompts,
  launchWebScaffold, recordFixture, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const FIXTURE = fileURLToPath(new URL('./snapshots/code-mode-round/session.jsonl', import.meta.url))
const UI_EXPECTED = fileURLToPath(new URL('./snapshots/code-mode-round/ui.expected.md', import.meta.url))
const MODE = webSnapshotMode()

// The scenario's one drive prompt: elicits one program with a bash sub-call
// and a failing read the program tolerates — the sub-row set the assertions
// need. Never asserted against model prose.
const PROMPT = 'Using ONE run_code program: run bash `echo CODE_ROUND_OK`, then read the file missing.txt '
  + 'catching its error in the program. Return an object with both outcomes. Then reply DONE and stop.'

describe('web e2e: Code Mode round renders nested sub-calls', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  const sessionEvents: SessionEvent[] = []

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      toolsMode: 'code',
      ...(MODE === 'record' ? {} : { replayFixture: FIXTURE, paceMs: 15 }),
    })
    scaffold.ctx.on('session/event', (_session, event: SessionEvent) => { sessionEvents.push(event) })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    // Fresh world: connect a Workspace so the composer scenarios start live.
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('drives the recorded prompt to a settled turn (all modes)', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-code-mode-drive'))
    if (MODE !== 'record') {
      // Drift guard: the committed fixture must carry exactly the drive prompt.
      expect(fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))).toEqual([PROMPT])
    }
    const input = page.locator('textarea').first()
    await input.waitFor({ timeout: 10_000 })
    const settled = scaffold.whenTurnSettled()
    await input.fill(PROMPT)
    await input.press('Enter')
    const sessionId = await settled
    if (MODE === 'record') {
      await recordFixture(scaffold, sessionId, FIXTURE)
    }
  }, 200_000)

  it.skipIf(MODE === 'record')('the durable log carries run_code with full-content sub-dispatches', () => {
    // Wire discipline: code mode collapsed the call surface to run_code.
    const calls = sessionEvents.filter(event => event.type === 'tool/call')
    expect(calls.length).toBeGreaterThanOrEqual(1)
    expect(new Set(calls.map(call => (call.data as { name: string }).name))).toEqual(new Set(['run_code']))
    // Sub-dispatches logged with the complete tool/result vocabulary.
    const dispatches = sessionEvents.filter(event => (event.type as string) === 'tool/code-dispatch')
    expect(dispatches.length).toBeGreaterThanOrEqual(2)
    for (const dispatch of dispatches) {
      const data = dispatch.data as unknown as {
        parentCallId: string
        subCallId: string
        name: string
        isError: boolean
        content: { type: string }[]
      }
      expect(data.subCallId.startsWith(`${data.parentCallId}:code:`)).toBe(true)
      expect(Array.isArray(data.content)).toBe(true)
      expect(typeof data.isError).toBe('boolean')
    }
    const bash = dispatches.find(dispatch => (dispatch.data as { name: string }).name === 'bash')
    expect(bash).toBeDefined()
    const bashContent = (bash!.data as { content: { type: string; text?: string }[] }).content
    expect(bashContent.filter(block => block.type === 'text').map(block => block.text).join('')).toContain('CODE_ROUND_OK')
  })

  it.skipIf(MODE === 'record')('renders the code parent row with always-visible nested sub-rows', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-code-mode-rows'))
    await expect.poll(() => page.getByText('DONE', { exact: true }).count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(1)
    // The parent run_code row wears the code variant with the model-authored
    // description as its summary (the presentCall contract).
    const codeRow = page.locator('[data-variant="code"]').first()
    await codeRow.waitFor({ timeout: 10_000 })
    // Nested rows are visible WITHOUT any expand interaction, inside the
    // sub-call nest, each rendered by the same components as native rows:
    // the bash sub-call landed in the bash sample registration.
    const nest = page.locator('[data-subcalls]').first()
    await nest.waitFor({ timeout: 10_000 })
    expect(await nest.locator('[data-sample="bash"]').count()).toBeGreaterThanOrEqual(1)
    // The failing read sub-call wears the same error state a native failed
    // row wears (the recorded program tolerates a read of missing.txt).
    expect(await nest.locator('[data-state="error"]').count()).toBeGreaterThanOrEqual(1)
  }, 60_000)

  it.skipIf(MODE === 'record')('a bash sub-row click leaves the default details panel closed', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-code-mode-details'))
    const nest = page.locator('[data-subcalls]').first()
    const frame = page.locator('[style*="grid-template-columns"]').first()
    expect(await frame.getAttribute('data-details-collapsed')).toBe('true')
    await nest.locator('[data-sample="bash"]').first().click()
    // Tool rows do not drive layout geometry; the Session's default panel stays closed.
    await expect.poll(() => frame.getAttribute('data-details-collapsed'), { timeout: 5_000 }).toBe('true')
  })

  it.skipIf(MODE === 'record')('matches the conversation aria golden with stable anchors', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-code-mode-aria'))
    const snapshot = await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)
  })

  it.skipIf(MODE === 'record')('stayed clean: no page errors, no reconnect churn', () => {
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })
})
