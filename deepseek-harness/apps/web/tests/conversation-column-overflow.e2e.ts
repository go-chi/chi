// Web e2e scenario: the conversation column scrolls on one axis only, as the
// browser actually lays it out. The hazard: a horizontal scrollbar appears
// under the whole center column once the window (or the sidebar drag) narrows
// it — the hero's decorative backdrop ellipse bleeds past the column and
// becomes user-scrollable.
//
// The bleed is by construction and stays: `.heroGlow` is sized 1051/776 of the
// hero box (ConversationRoot.module.css) so the blur scales with the input
// card. The scroll container is where the bar comes from:
// `[data-conversation-scroll]` scrolls vertically, and a one-axis scroller
// computes the other axis's initial `visible` to `auto`, so the bleed becomes
// a bar; `overflow-x: hidden` on the scroller prevents it.
//
// Only a real engine reports that pair — the bleed and the resulting scroll
// range — so the scenario sweeps viewport widths that bracket the glow's
// width and asserts both at each stop. Asserting no horizontal scroll alone
// would go vacuous the moment the glow stopped bleeding for an unrelated
// reason, which is why each stop also records whether it bleeds; the wide stop
// is the control where it does not.
//
// Zero model calls: the hero is the boot state, so nothing is seeded and no
// replay row mounts. A stray stream would fail loud with NO_ADAPTER.
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/conversation-column-overflow', import.meta.url))
/**
 * Committed golden of the one-axis relation at every stop. It records
 * relations and booleans, never absolute coordinates: the column width follows
 * the viewport and the sidebar, and a golden carrying pixels would document the
 * platform instead of the behavior.
 */
const GEOMETRY_EXPECTED = join(SNAPSHOT_DIR, 'geometry.expected.md')
const MODE = webSnapshotMode()
/** Narrow sweep stop where the mutation control retains overflow across scrollbar implementations. */
const CONTROL_VIEWPORT = 600
/**
 * Viewport widths bracketing the glow: the narrow stops retain the reported
 * bleed while the widest stop proves the relation can also be false.
 */
const WIDTHS = [1680, 1200, 1000, 800, CONTROL_VIEWPORT]
/** Element id of the mutation control's injected sheet, so the test can take it back out. */
const CONTROL_STYLE_ID = 'dsh-column-overflow-control'
/** Horizontal wheel delta per gesture; must exceed the widest bleed the sweep can produce. */
const WHEEL_DELTA = 300

/** One viewport stop: whether the glow bleeds past the column, and whether that bleed scrolls. */
interface ColumnMetrics {
  /** Viewport width the stop was measured at. */
  width: number
  /** The column's content width. Not committed to the golden — it is what settles after a resize, and what the sweep waits on. */
  columnWidth: number
  /** Resolved `overflow-x` on the conversation scroll container. */
  overflowX: string
  /**
   * True when the glow's box reaches past the column's content edge — the
   * condition the `overflow-x: hidden` declaration has to survive.
   */
  glowBleeds: boolean
  /**
   * `scrollWidth - clientWidth`. Deliberately NOT the assertion: `hidden` and
   * `auto` both report the same value, because `hidden` clips the bleed rather
   * than reflowing it away. Recorded because it is the vacuity guard in
   * numbers — it must stay positive at the narrow stops, or the scenario has
   * stopped reproducing the situation `overflow-x: hidden` exists for.
   */
  bleedRange: number
  /** True when the column still scrolls vertically — the axis `overflow-x: hidden` must not take away. */
  scrollsVertically: boolean
}

/**
 * Measure the conversation column at the page's current viewport.
 * @param page - the page under test.
 * @param width - the viewport width already applied, recorded with the reading.
 * @returns the stop's overflow relations.
 */
function measureColumn(page: Page, width: number): Promise<ColumnMetrics> {
  return page.evaluate((viewportWidth) => {
    const scroller = document.querySelector<HTMLElement>('[data-conversation-scroll]')
    if (scroller === null) throw new Error('conversation scroll container not in the DOM')
    const glow = scroller.querySelector<SVGElement>('[class*="heroGlow"]')
    if (glow === null) throw new Error('hero glow not in the DOM — the boot state is not the hero')
    const box = scroller.getBoundingClientRect()
    const glowBox = glow.getBoundingClientRect()
    return {
      width: viewportWidth,
      columnWidth: scroller.clientWidth,
      overflowX: getComputedStyle(scroller).overflowX,
      // `clientWidth` is the content edge, which is what the scrollable
      // overflow region is measured against; either side counts as a bleed,
      // though only the right one can produce a bar in this writing mode.
      glowBleeds: glowBox.right > box.left + scroller.clientWidth + 0.5 || glowBox.left < box.left - 0.5,
      bleedRange: scroller.scrollWidth - scroller.clientWidth,
      scrollsVertically: getComputedStyle(scroller).overflowY === 'auto',
    }
  }, width)
}

/**
 * Scroll the column sideways the way a user would and report where it landed.
 *
 * This is the one signal that separates the two states, and it is why the
 * scenario needs a real engine: `overflow-x: hidden` leaves the box
 * programmatically scrollable and leaves `scrollWidth` untouched, so every
 * property reading agrees across the two overflow modes. Only refusing an
 * actual input event differs — measured at the 1200px stop, the shipped
 * column stays at 0 while the same page with `overflow-x: auto` forced on
 * lands at its scroll boundary.
 * @param page - the page under test.
 * @returns `scrollLeft` after one horizontal wheel over the column.
 */
async function wheelHorizontally(page: Page): Promise<number> {
  const origin = await page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('[data-conversation-scroll]')
    if (scroller === null) throw new Error('conversation scroll container not in the DOM')
    // Start from the origin so the reading is this gesture's own effect.
    scroller.scrollLeft = 0
    const box = scroller.getBoundingClientRect()
    // Near the top of the column, clear of the centered hero card: the wheel
    // must reach the column, not a nested scroller the composer owns.
    return { x: box.left + box.width / 2, y: box.top + 60 }
  })
  await page.mouse.move(origin.x, origin.y)
  await page.mouse.wheel(WHEEL_DELTA, 0)
  // A fixed settle, then two frames. Polling for a settled value cannot be
  // used here — the value under test is 0, which a poll starting at 0 accepts
  // before the gesture has had any chance to move it — so the wait is
  // generous enough to cover a smooth-scroll animation on any engine the lane
  // runs on. The timing is identical on both sides of the mutation control
  // below, which is what makes a 0 reading evidence rather than a race won.
  await page.waitForTimeout(400)
  return page.evaluate(() => new Promise<number>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve(document.querySelector<HTMLElement>('[data-conversation-scroll]')?.scrollLeft ?? -1)
      })
    })
  }))
}

/**
 * Measure the positive horizontal scroll boundary without changing the
 * shipped overflow mode. This is distinct from `scrollWidth - clientWidth`
 * when a stable scrollbar gutter leaves part of the overflow on the negative
 * side of the scroll origin.
 * @param page - the page under test.
 * @returns the greatest positive `scrollLeft` reachable by the control gesture.
 */
async function horizontalScrollLimit(page: Page): Promise<number> {
  return page.evaluate((delta) => {
    const scroller = document.querySelector<HTMLElement>('[data-conversation-scroll]')
    if (scroller === null) throw new Error('conversation scroll container not in the DOM')
    const previousScrollBehavior = scroller.style.scrollBehavior
    scroller.style.scrollBehavior = 'auto'
    scroller.scrollLeft = delta
    const limit = scroller.scrollLeft
    scroller.scrollLeft = 0
    scroller.style.scrollBehavior = previousScrollBehavior
    return limit
  }, WHEEL_DELTA)
}

/** A stop's readings plus where a horizontal wheel over it landed. */
type ColumnStop = ColumnMetrics & {
  /** `scrollLeft` after one horizontal wheel: the user-facing claim, 0 at every stop. */
  scrollLeftAfterWheel: number
}

/**
 * Render the golden body: one line per stop, relations only.
 *
 * Absolute pixels are deliberately absent apart from `scrollLeftAfterWheel`,
 * which the shipped overflow mode pins to 0 by construction. The bleed is
 * recorded as a boolean rather than its width, so the golden survives any
 * platform whose column lands a pixel off — a fixture that has to be
 * re-recorded per platform documents the platform, not the behavior.
 * @param stops - the measured stops, in sweep order.
 * @returns the golden body, without a trailing newline.
 */
function renderGeometry(stops: ColumnStop[]): string {
  return [
    '# Conversation column horizontal overflow',
    '',
    '| viewport | overflow-x | glow bleeds past the column | scrollLeft after a horizontal wheel | scrolls vertically |',
    '| --- | --- | --- | --- | --- |',
    ...stops.map(stop => `| ${String(stop.width)}px | ${stop.overflowX} | ${String(stop.glowBleeds)} `
      + `| ${String(stop.scrollLeftAfterWheel)}px | ${String(stop.scrollsVertically)} |`),
  ].join('\n')
}

describe('web e2e: the conversation column scrolls on one axis', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    browser = await chromium.launch()
    page = await newEnglishPage(browser, 900)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[data-conversation-scroll] [class*="heroGlow"]', { timeout: 30_000 })
  }, 180_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  /**
   * Resize to a viewport and read the column once its width stops moving.
   *
   * The glow rides the hero box, which rides the column, and the frame eases
   * its column tracks over `--ds-transition-duration-slow`: reading straight
   * after a resize can report the previous viewport's relation, or a width
   * caught mid-transition.
   * @param width - viewport width to settle at.
   * @returns the column's readings at that width.
   */
  const settleAt = async (width: number): Promise<ColumnMetrics> => {
    await page.setViewportSize({ width, height: 900 })
    let previous = -1
    await expect.poll(async () => {
      const current = (await measureColumn(page, width)).columnWidth
      const settled = current === previous
      previous = current
      return settled
    }, { timeout: 10_000 }).toBe(true)
    return measureColumn(page, width)
  }

  /**
   * Sweep the stops once per run and hand the SAME readings to every assertion
   * below, so the golden and the assertions describe one measurement instead of
   * two runs that could disagree. Memoized rather than re-run per test: the
   * gestures below move the viewport, and a second sweep would be a second
   * chance for a resize to settle differently.
   * @returns the stops in {@link WIDTHS} order.
   */
  let swept: Promise<ColumnStop[]> | undefined
  const sweep = (): Promise<ColumnStop[]> => {
    swept ??= (async () => {
      const stops: ColumnStop[] = []
      for (const width of WIDTHS) {
        stops.push({ ...await settleAt(width), scrollLeftAfterWheel: await wheelHorizontally(page) })
      }
      return stops
    })()
    return swept
  }

  it('never scrolls horizontally, at any width the glow bleeds past', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-conversation-column-overflow'))
    const stops = await sweep()
    // The vacuity guard, in two halves: the glow has to reach past the column
    // at the narrow stops, and that reach has to still register as scrollable
    // overflow. Without both, the claim below holds for free.
    expect(stops.filter(stop => stop.glowBleeds).map(stop => stop.width)).toEqual([
      1200, 1000, 800, CONTROL_VIEWPORT,
    ])
    for (const stop of stops.filter(stop => stop.glowBleeds)) {
      expect(stop.bleedRange, `viewport ${String(stop.width)}`).toBeGreaterThan(0)
    }
    for (const stop of stops) {
      expect(stop.overflowX, `viewport ${String(stop.width)}`).toBe('hidden')
      // The reported symptom, stated directly: a horizontal wheel over the
      // column moves nothing, at every stop.
      expect(stop.scrollLeftAfterWheel, `viewport ${String(stop.width)}`).toBe(0)
      // The axis the column is a scroller for must survive `overflow-x: hidden`.
      expect(stop.scrollsVertically, `viewport ${String(stop.width)}`).toBe(true)
    }
    expect(tripwire.pageErrors).toEqual([])
  }, 120_000)

  it('scrolls horizontally again once the axis is opened back up (control)', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-conversation-column-overflow-control'))
    // The mutation control, run in the page rather than against a second
    // build: it lifts exactly the `overflow-x: hidden` declaration, so the
    // initial `visible` that a one-axis scroller computes to `auto` takes
    // over, and shows the same gesture, at the same timing, carrying the
    // column to its positive scroll boundary.
    // Without it a `scrollLeft` of 0 could equally mean the wheel never arrived.
    // Injected with an id rather than through `addStyleTag`, so the teardown
    // below can take the sheet out again by selector: it must not outlive this
    // test, or the golden ends up reading the control.
    await page.evaluate((id: string) => {
      const sheet = document.createElement('style')
      sheet.id = id
      sheet.textContent = '[data-conversation-scroll] { overflow-x: auto !important; }'
      document.head.append(sheet)
    }, CONTROL_STYLE_ID)
    try {
      // Resolve the mutated layout at the narrowest sweep stop. At wider stops,
      // a classic scrollbar can change the available box enough to remove the
      // overflow that the control is meant to expose.
      const before = await settleAt(CONTROL_VIEWPORT)
      expect(before.overflowX).toBe('auto')
      expect(before.bleedRange).toBeGreaterThan(0)
      const scrollLimit = await horizontalScrollLimit(page)
      // The control has a reachable horizontal range, and the gesture exceeds
      // it so the equality below proves that the wheel reached the far edge.
      expect(scrollLimit).toBeGreaterThan(0)
      expect(scrollLimit).toBeLessThan(WHEEL_DELTA)
      // Rounded: `scrollLeft` is fractional under a fractional layout while
      // the claim is that the column reached the positive boundary, not that
      // two engines agree on a sub-pixel.
      expect(Math.round(await wheelHorizontally(page))).toBe(Math.round(scrollLimit))
    } finally {
      await page.evaluate((id: string) => {
        document.getElementById(id)?.remove()
      }, CONTROL_STYLE_ID)
    }
    // The override is gone and the shipped state is back: the later goldens
    // read the product, not the control.
    expect((await settleAt(CONTROL_VIEWPORT)).overflowX).toBe('hidden')
    expect(tripwire.pageErrors).toEqual([])
  }, 120_000)

  it('matches the committed column-overflow golden', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-conversation-column-overflow-golden'))
    await compareOrRefreshGolden(GEOMETRY_EXPECTED, renderGeometry(await sweep()), MODE)
    expect(tripwire.pageErrors).toEqual([])
  }, 120_000)

  it('commits exactly the fixtures it reads', async () => {
    // No model calls, so no replay log: the golden is the whole inventory.
    await assertFixtureInventory(SNAPSHOT_DIR, ['geometry.expected.md'])
  })

  it.skipIf(MODE === 'record')('issued zero model calls and stayed clean', () => {
    expect(tripwire.warnings).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
  })
})
