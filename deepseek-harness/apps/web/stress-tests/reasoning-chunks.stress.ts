/**
 * Opt-in browser stress reproduction for reasoning-stream renderer stalls.
 * The fixture emits 100,000 individual chunks through the normal async
 * carrier; the test measures event-loop and scheduled-interaction delay while
 * the assembled React surface keeps a collapsed Think row live.
 */
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from '../tests/scaffold.ts'
import { newEnglishPage, saveFailureShot } from '../tests/support.ts'

const CHUNK_COUNT = 100_000
const CHUNKS_PER_INTERVAL = 128
const CHUNK_INTERVAL_MS = 16
const MAIN_THREAD_DELAY_BUDGET_MS = 250

interface ReasoningChunkStormState {
  sessionId: string
  chunkCount: number
  chunksPerInterval: number
  intervalMs: number
  emitted: number
  marker: string
  emitting: boolean
}

interface StressProbe {
  intervalId: number
  intervalMs: number
  lastTickAt: number
  maxDelayMs: number
  samples: number
  interactionDueAt: number
  interactionHandledAt: number | null
}

interface StressWindow extends Window {
  __fxTiming?: {
    startReasoningChunkStorm(id: string, chunkCount: number, chunksPerInterval: number, intervalMs: number): string
    reasoningChunkStormState(): ReasoningChunkStormState | null
  }
  __reasoningStressProbe?: StressProbe
}

it('keeps the browser responsive while rendering 100,000 reasoning chunks', async () => {
  let scaffold: WebScaffold | undefined
  let browser: Browser | undefined
  let page: Page | undefined
  try {
    scaffold = await launchWebScaffold()
    browser = await chromium.launch({ headless: process.env.DSH_WEB_STRESS_HEADFUL !== '1' })
    page = await newEnglishPage(browser)
    const activePage = page
    await activePage.addInitScript(() => {
      localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: 'fx-alpha' }))
    })
    const tripwire = watchConsole(activePage)
    onTestFailed(() => saveFailureShot(activePage, 'web-stress-reasoning-chunks'))
    await activePage.goto(`${scaffold.baseUrl}?fixture`, { waitUntil: 'load' })
    await activePage.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    // Fixture settings deliberately reject writes, so its welcome notice
    // cannot acknowledge. Hide only that test overlay; the assembled chat
    // tree beneath it remains mounted and exercises the production renderer.
    await activePage.addStyleTag({ content: '[class*="onboardingOverlay"] { display: none !important; }' })
    await activePage.locator('[data-sample="bash"]').first().waitFor({ timeout: 30_000 })

    await activePage.evaluate(() => {
      const intervalMs = 50
      const now = performance.now()
      const probe: StressProbe = {
        intervalId: 0,
        intervalMs,
        lastTickAt: now,
        maxDelayMs: 0,
        samples: 0,
        interactionDueAt: now + 1_000,
        interactionHandledAt: null,
      }
      probe.intervalId = window.setInterval(() => {
        const tickAt = performance.now()
        probe.maxDelayMs = Math.max(probe.maxDelayMs, tickAt - probe.lastTickAt - intervalMs)
        probe.lastTickAt = tickAt
        probe.samples++
      }, intervalMs)
      document.body.addEventListener('reasoning-stress-interaction', () => {
        probe.interactionHandledAt = performance.now()
      }, { once: true })
      window.setTimeout(() => {
        document.body.dispatchEvent(new CustomEvent('reasoning-stress-interaction'))
      }, 1_000)
      ;(window as StressWindow).__reasoningStressProbe = probe
    })

    const marker = await activePage.evaluate(({ chunkCount, chunksPerInterval, intervalMs }) => {
      const hooks = (window as StressWindow).__fxTiming
      if (hooks === undefined) throw new Error('reasoning stress fixture hooks unavailable')
      return hooks.startReasoningChunkStorm('fx-alpha', chunkCount, chunksPerInterval, intervalMs)
    }, {
      chunkCount: CHUNK_COUNT,
      chunksPerInterval: CHUNKS_PER_INTERVAL,
      intervalMs: CHUNK_INTERVAL_MS,
    })

    const liveThink = activePage.locator('[data-variant="think"][data-state="running"]').last()
    await liveThink.waitFor({ timeout: 60_000 })
    await expect.poll(async () => await activePage.evaluate(() => {
      const hooks = (window as StressWindow).__fxTiming
      return hooks?.reasoningChunkStormState()?.emitted ?? 0
    }), { timeout: 540_000, interval: 100 }).toBe(CHUNK_COUNT)
    await expect.poll(() => liveThink.textContent(), { timeout: 60_000, interval: 100 }).toContain(marker)

    const report = await activePage.evaluate(() => {
      const win = window as StressWindow
      const probe = win.__reasoningStressProbe
      const state = win.__fxTiming?.reasoningChunkStormState()
      if (probe === undefined || state === undefined || state === null) {
        throw new Error('reasoning stress metrics unavailable')
      }
      window.clearInterval(probe.intervalId)
      const interactionDelayMs = probe.interactionHandledAt === null
        ? null
        : probe.interactionHandledAt - probe.interactionDueAt
      return {
        chunkCount: state.chunkCount,
        chunksPerInterval: state.chunksPerInterval,
        intervalMs: state.intervalMs,
        emitted: state.emitted,
        maxMainThreadDelayMs: Math.max(0, probe.maxDelayMs),
        interactionDelayMs,
        heartbeatSamples: probe.samples,
      }
    })
    process.stdout.write(`reasoning-chunk stress report: ${JSON.stringify(report)}\n`)

    expect(report).toMatchObject({
      chunkCount: CHUNK_COUNT,
      chunksPerInterval: CHUNKS_PER_INTERVAL,
      intervalMs: CHUNK_INTERVAL_MS,
      emitted: CHUNK_COUNT,
    })
    expect(report.heartbeatSamples).toBeGreaterThan(0)
    const interactionDelayMs = report.interactionDelayMs
    if (interactionDelayMs === null) throw new Error(`scheduled interaction was not handled: ${JSON.stringify(report)}`)
    expect(report.maxMainThreadDelayMs, JSON.stringify(report)).toBeLessThan(MAIN_THREAD_DELAY_BUDGET_MS)
    expect(interactionDelayMs, JSON.stringify(report)).toBeLessThan(MAIN_THREAD_DELAY_BUDGET_MS)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  } finally {
    await browser?.close()
    await scaffold?.close()
  }
}, 600_000)
