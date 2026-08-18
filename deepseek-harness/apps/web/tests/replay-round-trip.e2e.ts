// Web e2e scenario: fresh round trip. A real chromium types a prompt into the
// real composer; the wire, apiproxy, agent loop, and the REAL bash tool (echo
// in the temp workspace) all run; the model adapter is dsh-llm-replay (keyless)
// or the live adapter (record). Drive steps run in every mode and wait only
// on generic completion (whenTurnSettled — never model-content selectors, so
// record cannot hang on a live model answering differently); assertion steps
// run in replay/refresh only. Settled states only — streaming incrementality
// is asserted from the persisted assistant/chunk events, not transient DOM.
// Record: DSH_SNAPSHOT=record rewrites session.jsonl, then a keyless
// DSH_SNAPSHOT=refresh regenerates ui.expected.md.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden, fixtureUserPrompts,
  launchWebScaffold, recordFixture, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, REPO_ROOT, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/fresh-round-trip', import.meta.url))
const FIXTURE = fileURLToPath(new URL('./snapshots/fresh-round-trip/session.jsonl', import.meta.url))
const UI_EXPECTED = fileURLToPath(new URL('./snapshots/fresh-round-trip/ui.expected.md', import.meta.url))
const SYSTEM_PROMPT_EXPECTED = fileURLToPath(new URL('./snapshots/fresh-round-trip/system-prompt.expected.md', import.meta.url))
const MODE = webSnapshotMode()

// The scenario's one drive prompt. Record sends it; replay asserts the
// committed fixture recorded exactly it, so drive script and fixture cannot
// drift apart.
const PROMPT = 'Use the bash tool to run exactly: echo WEB_E2E_OK. Then reply with the single word DONE and stop.'

describe('web e2e: fresh round trip through the real assembly', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let settledSessionId: SessionId | undefined
  const sessionEvents: SessionEvent[] = []

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
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
    onTestFailed(() => saveFailureShot(page, 'web-e2e-round-trip'))
    if (MODE !== 'record') {
      // Drift guard: the committed fixture must carry exactly the drive prompt.
      expect(fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))).toEqual([PROMPT])
    }
    const input = page.locator('textarea').first()
    await input.waitFor({ timeout: 10_000 })
    // Arm the host-side settled barrier BEFORE the send click.
    const settled = scaffold.whenTurnSettled()
    await input.fill(PROMPT)
    await input.press('Enter')
    const sessionId = await settled
    settledSessionId = sessionId
    if (MODE === 'record') {
      await recordFixture(scaffold, sessionId, FIXTURE)
    }
  }, 200_000)

  it('records the Web surface, source checkout, and session cwd in the request header', async () => {
    if (settledSessionId === undefined) throw new Error('the drive turn did not publish a session id')
    const agent = scaffold.ctx.agents.get(settledSessionId)
    if (agent === undefined) throw new Error(`the settled Web agent ${settledSessionId} is no longer live`)
    const system = agent.session.requestHeader()?.system
    if (system === undefined) throw new Error('the settled Web request has no system prompt')
    const prefix = system.split('\n\n').slice(0, 4).join('\n\n')
      .split(REPO_ROOT).join('{{sourceRoot}}')
      .split(join(scaffold.workspaceCwd, 'workspace')).join('{{cwd}}')
      .split(scaffold.baseUrl).join('{{webUrl}}')
    await compareOrRefreshGolden(SYSTEM_PROMPT_EXPECTED, prefix, MODE)
  })

  it('exposes the assembled Web URL to the real bash tool', async () => {
    if (settledSessionId === undefined) throw new Error('the drive turn did not publish a session id')
    const agent = scaffold.ctx.agents.get(settledSessionId)
    if (agent === undefined) throw new Error(`the settled Web agent ${settledSessionId} is no longer live`)
    const result = await scaffold.ctx.tools.execute({
      signal: AbortSignal.timeout(5_000),
      callId: CallId('web-url-probe'),
      name: 'bash',
      arguments: {
        command: 'printf \'%s\\n\' "$DSH_WEB_URL"',
        description: 'Print current Web runtime',
      },
      agent,
    })
    expect(result.isError).toBe(false)
    expect(result.content.filter(block => block.type === 'text').map(block => block.text).join(''))
      .toBe(`${scaffold.baseUrl}\n`)
  })

  it.skipIf(MODE === 'record')('rendered the settled turn: markdown, tool row, composer restore', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-round-trip-settled'))
    // Browser settled-poll after host completion (host strictly precedes render).
    await page.locator('[data-streaming="true"]').waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {
      // Chunks may coalesce into one commit; a never-mounted streaming node is
      // legal — the chunk-event assertions below carry incrementality.
    })
    await expect.poll(() => page.getByText('DONE', { exact: true }).count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(1)
    // World state, not self-report: the real bash executor returned the exact
    // command output, and the turn closed cleanly.
    const bashCall = sessionEvents.find(event => event.type === 'tool/call' && event.data.name === 'bash')
    if (bashCall?.type !== 'tool/call') throw new Error('the replayed turn did not call the bash tool')
    const bashResult = sessionEvents.find(event =>
      event.type === 'tool/result' && event.data.message.source.callId === bashCall.data.callId)
    if (bashResult?.type !== 'tool/result') throw new Error('the bash tool call produced no durable result')
    expect(bashResult.data.message.content[0].isError).toBe(false)
    expect(bashResult.data.message.content[0].content.filter(block => block.type === 'text').map(block => block.text).join(''))
      .toBe('WEB_E2E_OK\n')
    const turnEnds = sessionEvents.filter(e => e.type === 'turn/end')
    expect(turnEnds.length).toBe(1)
    expect((turnEnds[0] as SessionEvent & { data: { reason: { kind: string } } }).data.reason.kind).toBe('completed')
    // The persisted chunk events are the authoritative incrementality proof.
    expect(sessionEvents.filter(e => e.type === 'assistant/chunk').length).toBeGreaterThan(10)
  }, 60_000)

  it.skipIf(MODE === 'record')('matches the conversation aria golden with stable anchors', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-round-trip-aria'))
    // Anchor assertions survive a semantics-preserving component rewrite even
    // while the whole-region golden churns.
    await expect(page.getByRole('textbox').first().isVisible()).resolves.toBe(true)
    expect(await page.getByText('WEB_E2E_OK', { exact: false }).count()).toBeGreaterThanOrEqual(1)
    await page.getByRole('button', {
      name: 'Select model, current DeepSeek-V4-Flash',
    }).waitFor({ timeout: 10_000 })
    const snapshot = await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)
  })

  it.skipIf(MODE === 'record')('expands and collapses the reasoning fold from its click target', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-round-trip-think'))
    // Interaction over the REAL wire-delivered transcript (the fixture-client
    // tier pins the same gesture against FixtureApiClient; this one runs on
    // mux-frame-fed state). Runs after the golden capture so the committed
    // aria surface stays the untouched settled state.
    const think = page.getByRole('button', { name: /^Think/ }).first()
    expect(await think.getAttribute('aria-expanded')).toBe('false')
    await think.click()
    await expect.poll(() => think.getAttribute('aria-expanded'), { timeout: 5_000 }).toBe('true')
    await think.click()
    await expect.poll(() => think.getAttribute('aria-expanded'), { timeout: 5_000 }).toBe('false')
  })

  it.skipIf(MODE === 'record')('stayed clean: no pageerrors, no reconnect self-healing, no server errors', async () => {
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['session.jsonl', 'system-prompt.expected.md', 'ui.expected.md'])
  })
})
