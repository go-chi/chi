// Web e2e scenario: the sidebar session list's scrollbar as the browser
// actually lays it out — the observable half of the themed scrollbars
// (packages/client/ui-theme/src/styles/scrollbar.css plus the
// `scrollbar-gutter: stable` reservation on WorkspaceBrowser's `.list`). The
// ui-theme/ui-workspace unit specs read the CSS text; only a real engine
// reports the reserved gutter width and the substituted `scrollbar-color`, so
// those two facts live here.
//
// Zero model calls: the list only has to overflow, so the scenario seeds many
// cold sessions from another spec's committed fixture (seeded-history's
// seed.jsonl, reused read-only — this spec needs row count, not new recorded
// content) and never launches a replay row. A stray stream would fail loud
// with NO_ADAPTER.
//
// Headless-chromium caveats, load-bearing for what is asserted below.
//
// Headless chromium defaults to an OVERLAY scrollbar: one drawn on top of the
// content, consuming no layout width unless something reserves space. That is
// the mode in which the reported symptom exists at all, so this environment
// reproduces it rather than merely approximating it — without either
// declaration the list's band is 0 and the bar covers 7px of the relative
// time. (Under a classic space-consuming bar, `clientWidth` already excludes
// the bar and nothing can be covered; a headed run under xvfb behaves that way
// and cannot show the symptom.)
//
// The consequence for assertions: comparing the time element's right edge
// against the list's CLIENT-area right edge holds in both states and proves
// nothing, because with an overlay bar the client edge is the border edge. The
// two signals that do separate the states are the reserved band width and
// `timeCoveredBy`, which measures the overlap against the bar's own width.
//
// Both the `scrollbar-gutter: stable` reservation and the sheet's
// `::-webkit-scrollbar` width are needed for that band, and neither suffices:
// measured on the running app, deleting either one takes the band from 8 to 0
// while the other stays in force. The gutter states that space be reserved; the
// pseudo-element width is what makes chromium treat the bar as occupying layout
// space in the first place.
//
// That conjunction is why `band` and `timeCoveredBy` are both asserted and
// neither replaces the other. Removing only the gutter leaves `timeCoveredBy` at
// 0, because the bar is then 8px wide and the row's right padding is also 8px,
// so it abuts the timestamp without covering it; `band` catches that case.
// Removing both is what produces the reported overlap, and `timeCoveredBy`
// measures it at 7.
//
// The thumb is a pointer affordance (ui-sidebar rebinds the indirection pair
// to `transparent` while the pointer is outside the column), so every
// measurement below states which pointer position it was taken at: the
// scenario parks the pointer over the sidebar before asserting a colour, and
// the quiet state and its linger get their own test.
//
// Chromium also takes the `::-webkit-scrollbar*` path, not the standard
// properties: scrollbar.css gates `scrollbar-width`/`scrollbar-color` behind
// `@supports not selector(::-webkit-scrollbar)`, which is false here. The
// resolved standard properties therefore read `auto`, and that reading is
// asserted — a concrete value would mean the gate leaked and silenced the
// pseudo-element rules. What the theme test measures instead is the pair the
// pseudo-element rules read: the indirection variables as they resolve ON the
// list, plus the `::-webkit-scrollbar-thumb:hover` declaration as it stands in
// the cascade. The hover thumb colour is not observable any other way —
// chromium folds the `:hover` rule into `getComputedStyle(el,
// '::-webkit-scrollbar-thumb')`, so that query reports the hover colour at
// rest and cannot pin either state (measured by deleting the hover rule live:
// the same query flipped from the hover colour to the resting one).
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, compareOrRefreshGolden, launchWebScaffold, seedSession, watchConsole,
  webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SEED = fileURLToPath(new URL('./snapshots/seeded-history/seed.jsonl', import.meta.url))
const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/sidebar-scrollbar', import.meta.url))
/**
 * Committed golden of the resolved scrollbar style and geometry, in both
 * palettes. The aria goldens the other scenarios commit cannot carry this
 * change: it alters no DOM and no accessible name, so their normalized trees are
 * byte-identical with and without it. This one records the values instead, which
 * makes an unintended shift in thumb colour, band width, or rendering path a
 * reviewable diff rather than an assertion someone has to think about.
 */
const GEOMETRY_EXPECTED = join(SNAPSHOT_DIR, 'geometry.expected.md')
const MODE = webSnapshotMode()
/** Enough rows that the list overflows the 800px-tall viewport's sidebar; the scenario asserts the overflow rather than trusting it. */
const SEED_COUNT = 24

/** Geometry and resolved scrollbar style of one scroll container, measured in the page. */
interface ListMetrics {
  /** Resolved `scrollbar-gutter`. */
  gutter: string
  /** Resolved `::-webkit-scrollbar` width: the pseudo-element path's own sizing. */
  width: string
  /** Resolved `::-webkit-scrollbar-track` background. */
  track: string
  /** Resolved `scrollbar-width`, expected `auto` because the gate excludes chromium. */
  standardWidth: string
  /** Resolved `scrollbar-color`, expected `auto` for the same reason. */
  standardColor: string
  /** `::-webkit-scrollbar-thumb:hover` background declarations found in the cascade, in sheet order. */
  hoverRules: string[]
  /** `--dsh-scrollbar-thumb` resolved on the list, serialized as a colour. */
  token: string
  /** `--dsh-scrollbar-thumb-hover` resolved on the list, serialized the same way. */
  hoverToken: string
  /** True when the list actually scrolls. */
  overflows: boolean
  /** Border-box width minus client width: the space the scrollbar takes out of the content area. */
  band: number
  /** Distance from the scrollbar's right edge to the sidebar edge. */
  scrollbarEdgeOffset: number
  /** Distance from the first row background's right edge to the sidebar edge. */
  rowEdgeInset: number
  /** Client-area right edge in viewport coordinates (`clientWidth` excludes the scrollbar band). */
  clientRight: number
  /** Border-box right edge in viewport coordinates. */
  borderRight: number
  /** Right edge of the first row's relative-time element, the content the unreserved bar covered. */
  timeRight: number
  /**
   * Pixels of the relative time the scrollbar paints over: how far its right
   * edge reaches into the band the bar occupies, `[borderRight - barWidth,
   * borderRight]`. This is the reported symptom as a number, and it is the one
   * geometric signal that separates the two states in this environment — see
   * the file header on why `clientWidth` comparisons cannot.
   */
  timeCoveredBy: number
}

/**
 * Measure the sidebar list in the page.
 * @param page - the page under test.
 * @returns the list's resolved scrollbar style and the geometry the
 * scrollbar-gutter/thin-scrollbar declarations shape.
 */
function measureList(page: Page): Promise<ListMetrics> {
  return page.evaluate(() => {
    const list = document.querySelector<HTMLElement>('[role="tree"][aria-label="Sessions"]')
    if (list === null) throw new Error('sidebar session list not in the DOM')
    const time = list.querySelector<HTMLElement>('[class*="time"]')
    if (time === null) throw new Error('no row relative-time element in the sidebar list')
    const row = list.querySelector<HTMLElement>('[role="treeitem"]')
    if (row === null) throw new Error('no row in the sidebar list')
    // Each indirection variable is resolved through its own throwaway probe
    // appended to the list: `var()` substitution then happens where the list
    // sits in the cascade, which is the claim, and `color` normalizes whatever
    // notation the palette sheet chose into one comparable serialization. A
    // REUSED probe would report only the last value read — `getComputedStyle`
    // returns a live declaration, so reassigning `style.color` retroactively
    // changes every earlier read.
    const resolve = (name: string): string => {
      const probe = document.createElement('span')
      probe.style.color = `var(${name})`
      list.append(probe)
      const value = getComputedStyle(probe).color
      probe.remove()
      return value
    }
    // The hover colour is read out of the cascade rather than computed:
    // chromium reports the `:hover` background for the resting pseudo-element
    // too (see the file header), so no computed query separates the states.
    // Cross-origin sheets throw on `cssRules`; none is expected, and skipping
    // them cannot mask the rule under test, which ships in the app's own CSS.
    const hoverRules = [...document.styleSheets]
      .flatMap((sheet) => {
        try {
          return [...sheet.cssRules]
        } catch {
          return []
        }
      })
      .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule)
      .filter(rule => rule.selectorText === '::-webkit-scrollbar-thumb:hover')
      .map(rule => rule.style.getPropertyValue('background'))
    const style = getComputedStyle(list)
    const pseudoWidth = getComputedStyle(list, '::-webkit-scrollbar').width
    const barWidth = pseudoWidth === 'auto' ? 15 : Number.parseFloat(pseudoWidth)
    const listRect = list.getBoundingClientRect()
    const sidebarEdge = list.parentElement?.getBoundingClientRect().right
    if (sidebarEdge === undefined) throw new Error('sidebar session list has no layout parent')
    return {
      gutter: style.scrollbarGutter,
      width: pseudoWidth,
      track: getComputedStyle(list, '::-webkit-scrollbar-track').backgroundColor,
      standardWidth: style.scrollbarWidth,
      standardColor: style.scrollbarColor,
      hoverRules,
      token: resolve('--dsh-scrollbar-thumb'),
      hoverToken: resolve('--dsh-scrollbar-thumb-hover'),
      overflows: list.scrollHeight > list.clientHeight,
      band: listRect.width - list.clientWidth,
      scrollbarEdgeOffset: sidebarEdge - listRect.right,
      rowEdgeInset: sidebarEdge - row.getBoundingClientRect().right,
      clientRight: listRect.left + list.clientWidth,
      borderRight: listRect.right,
      timeRight: time.getBoundingClientRect().right,
      // The bar is drawn in the rightmost `barWidth` of the border box, whether
      // or not that space was reserved. Its width comes from the sheet where the
      // sheet applies, and from the UA's own overlay bar otherwise — 15px is
      // what this chromium paints, measured with the rule absent. Taking the
      // UA width as the fallback is what keeps the assertion
      // honest: assuming 0 there would report no occlusion precisely in the
      // state that has it.
      timeCoveredBy: Math.max(0, time.getBoundingClientRect().right - (listRect.right - barWidth)),
    }
  })
}

/**
 * Measure only overflow and row inset, which remain observable when every
 * session is hidden under a collapsed workspace group.
 * @param page - the page under test.
 * @returns the list overflow state and first row's trailing inset.
 */
function measureRowInset(page: Page): Promise<Pick<ListMetrics, 'overflows' | 'rowEdgeInset'>> {
  return page.evaluate(() => {
    const list = document.querySelector<HTMLElement>('[role="tree"][aria-label="Sessions"]')
    if (list === null) throw new Error('sidebar session list not in the DOM')
    const row = list.querySelector<HTMLElement>('[role="treeitem"]')
    if (row === null) throw new Error('no row in the sidebar list')
    const sidebarEdge = list.parentElement?.getBoundingClientRect().right
    if (sidebarEdge === undefined) throw new Error('sidebar session list has no layout parent')
    return {
      overflows: list.scrollHeight > list.clientHeight,
      rowEdgeInset: sidebarEdge - row.getBoundingClientRect().right,
    }
  })
}

/** One palette's readings, taken at both pointer positions. */
interface PaletteMetrics {
  /** Everything measured with the pointer over the list, which is when a thumb exists. */
  hovered: ListMetrics
  /** `--dsh-scrollbar-thumb` with the pointer parked outside the column. */
  quietThumb: string
}

/**
 * Read one palette at both pointer positions, ending with the pointer back
 * over the list so a caller measuring further leaves it revealed.
 * @param page - the page under test.
 * @returns the palette's quiet thumb and its hovered metrics.
 */
async function measurePalette(page: Page): Promise<PaletteMetrics> {
  await pointAt(page, 'away')
  // Poll rather than sleep the linger out: the wait is the column's, and a
  // fixed sleep would either race it or pad every palette.
  await expect.poll(async () => resolveThumb(page), { timeout: 10_000 }).toBe(NO_THUMB)
  const quietThumb = await resolveThumb(page)
  await pointAt(page, 'list')
  // Poll the reveal too: the reading below is a colour, and taking it in the
  // same tick as the pointer move would race React's flush and land a
  // transparent thumb in the golden.
  await expect.poll(async () => resolveThumb(page), { timeout: 10_000 }).not.toBe(NO_THUMB)
  return { hovered: await measureList(page), quietThumb }
}

/**
 * Render the golden body: the resolved scrollbar style of the list in each
 * palette, plus the geometric relations the scrollbar-gutter/thin-scrollbar
 * declarations establish.
 *
 * Absolute coordinates are deliberately absent. `timeRight`, `clientRight`, and
 * `borderRight` depend on the sidebar's laid-out width and on font metrics, so
 * committing them would make the golden fail on a machine whose fonts measure
 * differently — a fixture that has to be re-recorded per platform documents the
 * platform, not the behavior. What is recorded instead is the band, the overlap,
 * and the two orderings, each of which is a difference or a comparison and so
 * survives any layout that keeps the reservation.
 * @param light - metrics measured under the light palette.
 * @param dark - metrics measured under the dark palette.
 * @returns the golden body, without a trailing newline.
 */
function renderGeometry(light: PaletteMetrics, dark: PaletteMetrics): string {
  const palette = (name: string, { hovered: metrics, quietThumb }: PaletteMetrics): string[] => [
    `## ${name}`,
    '',
    `- --dsh-scrollbar-thumb, pointer outside the sidebar: ${quietThumb}`,
    `- scrollbar-gutter: ${metrics.gutter}`,
    `- ::-webkit-scrollbar width: ${metrics.width}`,
    `- ::-webkit-scrollbar-track background: ${metrics.track}`,
    `- scrollbar-width: ${metrics.standardWidth}`,
    `- scrollbar-color: ${metrics.standardColor}`,
    `- ::-webkit-scrollbar-thumb:hover declarations: ${metrics.hoverRules.join(' | ')}`,
    `- --dsh-scrollbar-thumb, pointer over the list: ${metrics.token}`,
    `- --dsh-scrollbar-thumb-hover, pointer over the list: ${metrics.hoverToken}`,
    `- list overflows: ${String(metrics.overflows)}`,
    `- reserved band: ${String(metrics.band)}px`,
    `- scrollbar inset from the sidebar edge: ${String(metrics.scrollbarEdgeOffset)}px`,
    `- row background inset from the sidebar edge: ${String(metrics.rowEdgeInset)}px`,
    `- relative time covered by the bar: ${String(metrics.timeCoveredBy)}px`,
    `- relative time ends inside the content area: ${String(metrics.timeRight <= metrics.clientRight)}`,
    `- content area ends before the border box: ${String(metrics.clientRight < metrics.borderRight)}`,
    '',
  ]
  return [
    '# Sidebar session list scrollbar',
    '',
    ...palette('Light palette', light),
    ...palette('Dark palette', dark),
  ].join('\n').trimEnd()
}

/**
 * Resolve `--dsh-scrollbar-thumb` as the list sees it, without the rest of the
 * geometry. Own probe element for the same reason {@link measureList} uses
 * one: `getComputedStyle` returns a live declaration.
 * @param page - the page under test.
 * @returns the resolved thumb colour, serialized as `rgb`/`rgba`.
 */
function resolveThumb(page: Page): Promise<string> {
  return page.evaluate(() => {
    const list = document.querySelector<HTMLElement>('[role="tree"][aria-label="Sessions"]')
    if (list === null) throw new Error('sidebar session list not in the DOM')
    const probe = document.createElement('span')
    probe.style.color = 'var(--dsh-scrollbar-thumb)'
    list.append(probe)
    const value = getComputedStyle(probe).color
    probe.remove()
    return value
  })
}

/** Fully transparent, which is how the quiet column spells "no thumb". */
const NO_THUMB = 'rgba(0, 0, 0, 0)'

/**
 * Park the pointer over the session list or outside the sidebar entirely. The
 * column reveals its scrollbars from real pointer movement, so a scenario that
 * never moves the mouse measures the quiet state whatever it intended to.
 * @param page - the page under test.
 * @param where - `list` to point at the session list, `away` for the far side
 * of the viewport (the conversation column).
 */
async function pointAt(page: Page, where: 'list' | 'away'): Promise<void> {
  const box = await page.locator('[role="tree"][aria-label="Sessions"]').boundingBox()
  if (box === null) throw new Error('sidebar session list has no layout box')
  const viewport = page.viewportSize()
  if (viewport === null) throw new Error('page has no viewport')
  const target = where === 'list'
    ? { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    : { x: viewport.width - 5, y: box.y + box.height / 2 }
  await page.mouse.move(target.x, target.y)
}

/**
 * Reveal the seeded rows: every seeded session is unattached, so they all sit
 * in the collapsed Ungrouped bucket. Open the bucket, then use its transient
 * Show-more control because an open group intentionally renders only five
 * rows by default. Hand-rolled polling because
 * `expect.poll` is test-scoped and this runs in `beforeAll`.
 * @param page - the page under test.
 */
async function expandSeededSessions(page: Page): Promise<void> {
  const bucket = page.getByText('Ungrouped', { exact: true }).locator('..').locator('..')
  await bucket.waitFor({ timeout: 15_000 })
  const rows = page.locator('[role="tree"][aria-label="Sessions"] [role="treeitem"]')
  const deadline = Date.now() + 30_000
  for (;;) {
    if (await bucket.getAttribute('aria-expanded') !== 'true') {
      await page.getByText('Ungrouped', { exact: true }).click()
    }
    const showMore = page.getByRole('button', { name: /Show \d+ more sessions/ })
    if (await bucket.getAttribute('aria-expanded') === 'true'
      && await rows.count() <= SEED_COUNT / 2
      && await showMore.count() > 0) {
      await showMore.click()
    }
    if (await bucket.getAttribute('aria-expanded') === 'true' && await rows.count() > SEED_COUNT / 2) return
    if (Date.now() > deadline) {
      throw new Error(`Ungrouped bucket never revealed more than ${SEED_COUNT / 2} rows`)
    }
    await page.waitForTimeout(200)
  }
}

describe('web e2e: sidebar session list scrollbar (reserved gutter / themed thumb)', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    const fixture = await readFile(SEED, 'utf8')
    for (let index = 0; index < SEED_COUNT; index += 1) {
      await seedSession(scaffold, fixture, `sidebar-scrollbar-web-e2e-${String(index).padStart(2, '0')}`)
    }
    browser = await chromium.launch()
    // Shorter than the other scenarios' 1000px so SEED_COUNT rows overflow
    // the list with room to spare.
    page = await newEnglishPage(browser, 800)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await expandSeededSessions(page)
    // Every assertion about a thumb colour needs a drawn thumb, and the column
    // only draws one under the pointer; the quiet state is asserted where it is
    // the subject rather than left as an ambient condition of the whole file.
    await pointAt(page, 'list')
  }, 180_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('reserves a scrollbar gutter on the overflowing session list', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-sidebar-scrollbar-gutter'))
    // Vacuity guard: with a non-overflowing list `stable` still reserves, but
    // the scenario would no longer be reproducing the reported situation.
    await expect.poll(async () => (await measureList(page)).overflows, { timeout: 10_000 }).toBe(true)
    const metrics = await measureList(page)
    expect(metrics.gutter).toBe('stable')
    // The control. `band > 0` is the whole observable effect of the
    // reservation: the scrollbar is taken out of the content area instead of
    // drawn over it. Removing the declaration makes it exactly 0. The value
    // itself is not pinned — it tracks `scrollbar-width` and the platform.
    expect(metrics.band).toBeGreaterThan(0)
    expect(metrics.scrollbarEdgeOffset).toBe(2)
    expect(metrics.rowEdgeInset).toBe(12)
    // The reported symptom, stated directly: no part of the row's relative time
    // lies under the bar. Without either declaration it measures 7 — the `h`
    // of `1h` is the covered part. Unlike the client-edge comparison below it
    // does not go vacuous under an overlay scrollbar, because it measures
    // against the bar's own width rather than against a content edge the
    // overlay bar does not move. It is not a replacement for the band
    // assertion above; see the file header for which regression each one
    // catches.
    expect(metrics.timeCoveredBy).toBe(0)
    // Corollaries of the reservation, kept because they pin where the band sits
    // rather than only that it exists: the time ends inside the content area,
    // and the content area ends before the border box. Each holds in both
    // states on its own (see the file header) and is meaningful only alongside
    // the two assertions above.
    expect(metrics.timeRight).toBeLessThanOrEqual(metrics.clientRight)
    expect(metrics.clientRight).toBeLessThan(metrics.borderRight)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('draws no thumb until the pointer is over the column, and lingers on the way out', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-sidebar-scrollbar-pointer'))
    const revealed = await resolveThumb(page)
    expect(revealed).not.toBe(NO_THUMB)
    await pointAt(page, 'away')
    // The linger, measured as a state rather than a duration: the thumb is
    // still drawn on the leave itself, and gone once the window has passed. A
    // tighter timing assertion would pin the wall clock of a CI machine.
    expect(await resolveThumb(page)).toBe(revealed)
    await expect.poll(async () => resolveThumb(page), { timeout: 10_000 }).toBe(NO_THUMB)
    // The reservation is unconditional, so nothing moved while the bar was
    // hidden — this is what buys `transparent` over hiding the bar itself.
    const quiet = await measureList(page)
    expect(quiet.gutter).toBe('stable')
    expect(quiet.band).toBeGreaterThan(0)
    expect(quiet.timeCoveredBy).toBe(0)
    // Scrolling without a pointer — what a keyboard or a touch drag does —
    // leaves the column quiet. This is the one deliberate loss, and
    // it is pinned here rather than only described, so making a scroll
    // re-reveal the bar has to be a decision rather than a side effect.
    await page.locator('[role="tree"][aria-label="Sessions"]').evaluate((el) => { el.scrollTop += 200 })
    await page.waitForTimeout(500)
    expect(await resolveThumb(page)).toBe(NO_THUMB)
    await pointAt(page, 'list')
    await expect.poll(async () => resolveThumb(page), { timeout: 10_000 }).toBe(revealed)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('keeps the row background inset when overflow disappears', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-sidebar-scrollbar-stable-inset'))
    expect(await measureRowInset(page)).toEqual({ overflows: true, rowEdgeInset: 12 })
    const bucket = page.getByText('Ungrouped', { exact: true }).locator('..').locator('..')
    await bucket.click()
    try {
      await expect.poll(async () => (await measureRowInset(page)).overflows, { timeout: 10_000 }).toBe(false)
      expect(await measureRowInset(page)).toEqual({ overflows: false, rowEdgeInset: 12 })
    } finally {
      await expandSeededSessions(page)
    }
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('renders the themed thumb through the WebKit path in both palettes', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-sidebar-scrollbar-theme'))
    const light = await measureList(page)
    // The gate's signature on this engine, and the reason it exists: chromium
    // implements `::-webkit-scrollbar`, so the standard properties stay at
    // their initial `auto`. A concrete value here would mean the gate leaked,
    // which is exactly what makes chromium discard the pseudo-element rules —
    // the hover token included.
    expect(light.standardWidth).toBe('auto')
    expect(light.standardColor).toBe('auto')
    // The pseudo-element path is the one in force: the sheet's own 8px sizing
    // and transparent track reached a container it never names.
    expect(light.width).toBe('8px')
    expect(light.track).toBe('rgba(0, 0, 0, 0)')
    // The resting and the hover rule each read the rebindable indirection, and
    // the two resolve to DIFFERENT colours on this list: the l1 pair arrived
    // here intact rather than collapsing to one value or falling back.
    expect(light.hoverRules).toEqual(['var(--dsh-scrollbar-thumb-hover)'])
    expect(light.token).toMatch(/^rgba?\(/)
    expect(light.hoverToken).not.toBe(light.token)
    // The dark palette declares different scrollbar tokens; driving the body
    // attribute pins the cascade the way lifecycle-chrome does (the Settings
    // gesture that sets it is owned there).
    await page.evaluate(() => { document.body.setAttribute('data-ds-dark-theme', '') })
    const dark = await measureList(page)
    expect(dark.token).not.toBe(light.token)
    expect(dark.hoverToken).not.toBe(dark.token)
    expect(dark.hoverToken).not.toBe(light.hoverToken)
    await page.evaluate(() => { document.body.removeAttribute('data-ds-dark-theme') })
    const restored = await measureList(page)
    expect(restored.token).toBe(light.token)
    expect(restored.hoverToken).toBe(light.hoverToken)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('matches the committed scrollbar geometry golden in both palettes', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-sidebar-scrollbar-golden'))
    const light = await measurePalette(page)
    await page.evaluate(() => { document.body.setAttribute('data-ds-dark-theme', '') })
    const dark = await measurePalette(page)
    await page.evaluate(() => { document.body.removeAttribute('data-ds-dark-theme') })
    await compareOrRefreshGolden(GEOMETRY_EXPECTED, renderGeometry(light, dark), MODE)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('commits exactly the fixtures it reads', async () => {
    // The scenario borrows seeded-history's seed.jsonl rather than committing a
    // second copy, so this directory holds the golden alone.
    await assertFixtureInventory(SNAPSHOT_DIR, ['geometry.expected.md'])
  })

  it.skipIf(MODE === 'record')('issued zero model calls and stayed clean', () => {
    expect(tripwire.warnings).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
  })
})
