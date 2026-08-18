/** Cold Session list visibility through the shipped compressed JSONL backend. */

import { mkdir, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, seedBlankSession,
  watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/cold-blank-session', import.meta.url))
const SIDEBAR_EXPECTED = join(SNAPSHOT_DIR, 'sidebar.expected.md')
const MODE = webSnapshotMode()
const SESSION_ID = 'cold-blank-session-web-e2e'
const WORKSPACE_NAME = 'cold-blank-workspace'

describe('web e2e: cold blank Session visibility', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    const cwd = join(scaffold.workspaceCwd, WORKSPACE_NAME)
    await mkdir(cwd, { recursive: true })
    await seedBlankSession(scaffold, SESSION_ID, cwd)
    const header = (await scaffold.ctx.sessionPersistence.list())
      .find(candidate => candidate.id === SESSION_ID)
    if (header === undefined) throw new Error('blank Session fixture did not materialize')
    const location = scaffold.ctx.sessionPersistence.locate(header)
    if (location === undefined) throw new Error('JSONL fixture has no physical artifact')
    expect((await stat(location.path)).size).toBeLessThanOrEqual(1024)

    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('keeps the verified cold blank Session out of the sidebar', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-cold-blank-session'))
    const tree = page.getByRole('tree', { name: 'Sessions' })
    await tree.waitFor({ timeout: 30_000 })
    expect(await tree.getByText(WORKSPACE_NAME, { exact: true }).count()).toBe(0)
    const sidebar = await captureStableAria(page, '[role="tree"][aria-label="Sessions"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(SIDEBAR_EXPECTED, sidebar, MODE)
    expect(tripwire.pageErrors).toEqual([])
  })
})
