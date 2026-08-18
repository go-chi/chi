// Web e2e scenario: the resident question composer. The shipped composition
// already exposes ask_user_question (the ui-user-questions row's node half mounts
// the tool), so a recorded turn where the model asks blocks mid-turn on the
// real userInteraction seam: the composer renders in the browser, the test
// answers through it, and the turn completes with the answer in the log.
// Replay is fully deterministic — the question content arrives from replayed
// chunks, the composer wait is real, and the answer click is the test's own
// gesture (the ONE place a drive step legitimately reacts to model content:
// the turn cannot complete without it, in record and replay alike).
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden, fixtureUserPrompts,
  launchWebScaffold, recordFixture, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/question-composer', import.meta.url))
const FIXTURE = join(SNAPSHOT_DIR, 'session.jsonl')
const UI_EXPECTED = join(SNAPSHOT_DIR, 'ui.expected.md')
const SIDEBAR_EXPECTED = join(SNAPSHOT_DIR, 'sidebar.expected.md')
const COMPOSED_EXPECTED = join(SNAPSHOT_DIR, 'composed.expected.md')
// Final golden: the answered transcript — the question resolved into its tool
// round trip and the final reply, the state the composer goldens cannot see.
const ANSWERED_EXPECTED = join(SNAPSHOT_DIR, 'answered.expected.md')
const MODE = webSnapshotMode()

// The options carry long descriptions on purpose: the squeeze assertion below
// needs option copy that WRAPS, which is the only text layout that reproduces a
// collapsed row painting its copy outside its own box.
const PROMPT = 'Use the ask_user_question tool to ask me exactly one multi-select question with id "color", question "Which color do you prefer?", header "Pick one", and two options: label "Blue" with description "A cool recessive hue that reads as calm and trustworthy in long reading sessions and dense dashboards.", and label "Green" with description "A restful mid-spectrum hue with the highest perceived brightness, easiest on the eye over long sessions." Set multi_select to true. After I answer, reply with the single word DONE and stop.'

describe('web e2e: resident question composer round trip', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  const sessionEvents: SessionEvent[] = []

  beforeAll(async () => {
    scaffold = await launchWebScaffold(MODE === 'record' ? {} : { replayFixture: FIXTURE, paceMs: 15 })
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

  it('asks through the composer, answers, and completes with the answer logged', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-question'))
    if (MODE !== 'record') {
      expect(fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))).toEqual([PROMPT])
    }
    const input = page.locator('textarea').first()
    await input.waitFor({ timeout: 10_000 })
    const settled = scaffold.whenTurnSettled(MODE === 'record' ? 180_000 : 30_000)
    await input.fill(PROMPT)
    await input.press('Enter')

    // The composer takes over the input area while the tool blocks. Its
    // presence is a STABLE waiting state (not a transient): it stays until
    // answered, so a plain waitFor is race-free.
    const composer = page.locator('[data-question-key]')
    await composer.waitFor({ timeout: MODE === 'record' ? 120_000 : 30_000 })
    await expect.poll(() => composer.getByText('Which color do you prefer?').count(), { timeout: 10_000 }).toBeGreaterThan(0)

    const selectedRow = page.locator('[role="treeitem"][aria-selected="true"]')
    await expect.poll(() => selectedRow.locator('[data-state="warning"]').count(), { timeout: 10_000 }).toBe(1)
    await expect.poll(() => selectedRow.getByText('Waiting for answer', { exact: true }).count(), { timeout: 10_000 }).toBe(1)

    if (MODE !== 'record') {
      // This golden owns the stable question surface; the answered-state
      // golden below owns the resulting transcript.
      const snapshot = await captureStableAria(page, '[data-question-key]', scaffold.workspaceCwd)
      await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)
      const sidebar = await captureStableAria(page, '[role="treeitem"][aria-selected="true"]', scaffold.workspaceCwd)
      await compareOrRefreshGolden(SIDEBAR_EXPECTED, sidebar, MODE)
    }

    // Squeezed card: the option rows are the capped card's scroll content, so
    // shrinking the seat must push overflow into the option list, never
    // collapse a row below the height its own copy needs — a collapsed row
    // paints its centered copy outside the row box, over the title and the
    // neighbouring rows. Measured on the live composer at seat heights that
    // force the cap, then restored for the answer gesture below. Replay only:
    // record mode must reach the recording write below, not abort on layout.
    if (MODE !== 'record') {
      const original = page.viewportSize() ?? { width: 1680, height: 1000 }
      for (const height of [520, 440, 380]) {
        await page.setViewportSize({ width: 900, height })
        const squeeze = await composer.evaluate((card) => {
          // Role/ARIA selectors, not the CSS-module class names: the built
          // client hashes those.
          const rows = [...card.querySelectorAll<HTMLElement>(
            '[role="radio"], [role="checkbox"], [aria-expanded]',
          )]
          const spill = rows.map(row => Math.max(...[...row.children].map((child) => {
            const box = row.getBoundingClientRect()
            const inner = child.getBoundingClientRect()
            return Math.max(box.top - inner.top, inner.bottom - box.bottom)
          })))
          const list = card.querySelector<HTMLElement>('[data-question-scroll]')
          return {
            rows: rows.length,
            spill: Math.max(...spill),
            // Wrapped option text is what overflows a collapsed row, and a
            // scrolling list proves the seat is genuinely capped. Without both,
            // the spill assertion would hold vacuously.
            wrappedRows: rows.filter(row => row.getBoundingClientRect().height > 42).length,
            scrolls: list === null ? false : list.scrollHeight > list.clientHeight,
          }
        })
        expect(squeeze.rows).toBeGreaterThan(0)
        expect(squeeze.wrappedRows).toBeGreaterThan(0)
        expect(squeeze.scrolls).toBe(true)
        // Sub-pixel tolerance: every row's copy stays inside its border box.
        expect(squeeze.spill).toBeLessThan(0.6)
      }
      await page.setViewportSize(original)
    }

    const blue = composer.getByRole('checkbox', { name: 'Blue' })
    await blue.click()
    const custom = composer.getByRole('textbox')
    await custom.fill('Include accessibility notes')
    expect(await blue.getAttribute('aria-checked')).toBe('true')
    expect(await custom.inputValue()).toBe('Include accessibility notes')
    if (MODE !== 'record') {
      const snapshot = await captureStableAria(page, '[data-question-key]', scaffold.workspaceCwd)
      await compareOrRefreshGolden(COMPOSED_EXPECTED, snapshot, MODE)
    }
    await custom.press('Enter')

    const sessionId = await settled
    if (MODE === 'record') {
      await recordFixture(scaffold, sessionId, FIXTURE)
      return
    }
    // World state: the tool result carries the chosen answer, and DONE lands.
    const results = sessionEvents.filter(e => e.type === 'tool/result')
    const answerText = results.flatMap(event => event.data.message.content.flatMap(block =>
      block.type === 'tool-result'
        ? block.content.filter(item => item.type === 'text').map(item => item.text)
        : [],
    )).at(-1)
    expect(JSON.parse(answerText ?? '')).toEqual({
      answers: [{ id: 'color', selected: ['Blue'], custom: 'Include accessibility notes' }],
    })
    await expect.poll(() => page.getByText('DONE', { exact: true }).count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(1)
    // Composer gone; regular input restored.
    expect(await page.locator('[data-question-key]').count()).toBe(0)
    expect(await selectedRow.locator('[data-state="warning"]').count()).toBe(0)
    await expect.poll(() => page.locator('textarea').first().isEnabled(), { timeout: 10_000 }).toBe(true)
    // Golden of the answered transcript: the ask_user_question round trip
    // rendered as history (question tool row + DONE), composer takeover gone.
    const snapshot = await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(ANSWERED_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 200_000)

  it.skipIf(MODE === 'record')('keeps the fixture inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, [
      'session.jsonl',
      'ui.expected.md',
      'sidebar.expected.md',
      'composed.expected.md',
      'answered.expected.md',
    ])
  })
})
