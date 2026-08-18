// Web e2e scenario: a composer draft longer than the 14-line cap scrolls its
// GLYPHS AND ITS CARET AS ONE.
//
// The composer paints its text in two stacked layers (see
// packages/client/ui-conversation/src/client/skeleton/InputBar.module.css): the
// `<textarea>` carries the value, the selection and the caret but renders its
// own glyphs `color: transparent`, and every visible character is painted by the
// `[data-input-backdrop]` div underneath it, which also carries the claim-token
// highlight, the chips and the ghost hint.
//
// Two layers can only stay together by moving together. They do: both sit
// inside `[data-input-scroll]`, the composer's single scrolling box, and are as
// tall as the whole draft — so one offset, applied by the browser, moves the
// caret and the words in the same frame. Scrolling the textarea and assigning
// its offset to the backdrop looks equivalent and is not: a wheel gesture is
// composited off the main thread, so the assignment lands frames late and the
// caret visibly flies ahead of the text it belongs to.
//
// That failure is what the same-task measurement below pins. Every metric here
// is read through the caret's own coordinate frame — where the textarea puts
// line n — against where the backdrop paints line n, because that difference is
// the defect a user sees, and it is the one number a mirror between two boxes
// cannot hold at zero.
//
// Only a real engine can show any of this. Scrolling is layout: jsdom reports
// `scrollHeight === clientHeight` for every element and never scrolls one, so
// the unit spec in packages/client/ui-conversation/tests/input-bar.client.spec.tsx can
// only assert that one scrollport contains both layers.
//
// Zero model calls: a fresh workspace's blank session already carries a live
// composer, and the scenario only types into it. A stray stream would fail loud
// with NO_ADAPTER.
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, compareOrRefreshGolden, launchWebScaffold, watchConsole,
  webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/composer-draft-scroll', import.meta.url))
/**
 * Committed golden of the composer's two-layer scroll geometry. The change
 * alters no accessible name, so the aria goldens the other scenarios commit are
 * byte-identical with and without it; this records the relations instead, which
 * makes a shift in the cap or in the layer coupling a reviewable diff rather
 * than an assertion someone has to reconstruct.
 */
const GEOMETRY_EXPECTED = join(SNAPSHOT_DIR, 'geometry.expected.md')
const MODE = webSnapshotMode()

/** Marks the first and last line so a Range can find them in the backdrop's text. */
const FIRST_MARKER = 'FIRST-LINE-MARKER'
const LAST_MARKER = 'LAST-LINE-MARKER'
/** Comfortably past the 14-line cap, so the draft overflows however the lines wrap. */
const DRAFT_LINES = 40
const DRAFT = Array.from({ length: DRAFT_LINES }, (_unused, index) => {
  if (index === 0) return FIRST_MARKER
  if (index === DRAFT_LINES - 1) return LAST_MARKER
  return `draft line ${String(index + 1).padStart(2, '0')}`
}).join('\n')

/**
 * A draft ending in a newline, where the two layers reserve their
 * final line box on different terms. A textarea keeps one for the caret after a
 * final newline; `white-space: pre-wrap` collapses a text node's trailing
 * newline and generates none. The hidden auto-grow mirror carries the newline
 * and so decides the height for both, which is why the backdrop needs no
 * padding of its own — but only a draft with a trailing newline can show it.
 */
const DRAFT_TRAILING_NEWLINE = `${DRAFT}\n`

/** The composer's text layers as the browser lays them out. */
interface ComposerMetrics {
  /** True when the draft is taller than the capped box — the situation under test. */
  overflows: boolean
  /** Visible height of the scrollport's content box: the cap in pixels. */
  clientHeight: number
  /** Whole lines that fit in the visible box, at the composer's own line-height. */
  visibleLines: number
  /** The composer's one scroll offset, which the caret and the glyphs both follow. */
  scrollTop: number
  /** Furthest that offset can go. */
  scrollMax: number
  /**
   * Scrollable overflow the textarea holds on its own — 0, or a second offset
   * exists that nothing keeps equal to this one.
   */
  inputScrollable: number
  /**
   * Distance between where the caret sits for a draft line and where the
   * backdrop paints that line, in pixels. A fixed value (the difference between
   * a line box's top and its glyph box's) is alignment; a value that CHANGES
   * with the scroll offset is the defect — the words trailing the caret.
   */
  caretGlyphGap: number
  /**
   * How much that gap moves when the offset changes inside a single task: 0
   * here, because one box carries both layers. Assigning one box's offset to
   * another cannot be 0 — a scroll event is dispatched after the task that
   * moved the box, so between the two there is a frame with the caret at the
   * new offset and the glyphs at the old one.
   */
  gapShiftOnScroll: number
  /**
   * Top of the LAST draft line relative to the visible box's top, in pixels: at
   * most `clientHeight` when that line is on screen.
   */
  lastLineOffset: number
  /** Top of the FIRST draft line relative to the visible box's top: negative once it has scrolled out. */
  firstLineOffset: number
  /** Content width the textarea wraps at. */
  inputWrapWidth: number
  /** Content width the backdrop wraps at — equal, or the layers break lines in different places. */
  backdropWrapWidth: number
  /** Content width the hidden auto-grow mirror wraps at — it decides the box's height. */
  mirrorWrapWidth: number
}

/**
 * Measure the composer's layers in the page, in the caret's coordinate frame.
 * @param page - the page under test.
 * @returns the offset, the caret-to-glyph gap, and where the draft's first and last lines sit.
 */
function measureComposer(page: Page): Promise<ComposerMetrics> {
  return page.evaluate(({ first, last }) => {
    const input = document.querySelector<HTMLTextAreaElement>('textarea:enabled')
    if (input === null) throw new Error('no live composer textarea in the DOM')
    const scroll = input.closest<HTMLElement>('[data-input-scroll]')
    if (scroll === null) throw new Error('the composer textarea is not inside a draft scrollport')
    const backdrop = input.parentElement?.querySelector<HTMLElement>('[data-input-backdrop]')
    if (backdrop === undefined || backdrop === null) throw new Error('no decoration backdrop beside the composer textarea')
    // The hidden auto-grow mirror: the textarea's next sibling, and the layer
    // that decides the box's height, so its wrap width matters as much as the
    // two that carry glyphs.
    const mirror = input.nextElementSibling
    if (!(mirror instanceof HTMLElement)) throw new Error('no auto-grow mirror after the composer textarea')
    // The draft carries no chips or claim token, so the decoration walk emits it
    // as a single text node, which is what the Range below needs.
    const text = backdrop.firstChild
    if (!(text instanceof Text)) throw new Error('backdrop does not open with a plain text node')
    const lineHeight = Number.parseFloat(getComputedStyle(input).lineHeight)
    /** Where the backdrop paints the line holding `marker`, in viewport coordinates. */
    const glyphTop = (marker: string): number => {
      const at = text.data.indexOf(marker)
      if (at < 0) throw new Error(`marker ${marker} missing from the backdrop text`)
      const range = document.createRange()
      range.setStart(text, at)
      range.setEnd(text, at + marker.length)
      return range.getBoundingClientRect().top
    }
    const paddingTop = Number.parseFloat(getComputedStyle(input).paddingTop)
    // Where the CARET sits on the draft's first line: the textarea lays its own
    // (transparent) glyphs out from its border box, shifted by any offset it
    // holds itself. Reading the caret's frame this way rather than the
    // scrollport's is what makes the gap the user-visible quantity — it stays
    // honest if the textarea ever starts scrolling on its own again.
    const gap = (): number =>
      Math.round(input.getBoundingClientRect().top + paddingTop - input.scrollTop - glyphTop(first))
    // The same-task probe: move the offset and re-read the gap before the task
    // ends, which is before any scroll event could have run a listener.
    const before = gap()
    const restore = scroll.scrollTop
    scroll.scrollTop = restore === 0 ? 120 : 0
    const gapShiftOnScroll = Math.abs(gap() - before)
    scroll.scrollTop = restore
    const box = scroll.getBoundingClientRect()
    return {
      inputWrapWidth: input.clientWidth,
      backdropWrapWidth: backdrop.clientWidth,
      mirrorWrapWidth: mirror.clientWidth,
      overflows: scroll.scrollHeight > scroll.clientHeight,
      clientHeight: scroll.clientHeight,
      visibleLines: Math.floor(scroll.clientHeight / lineHeight),
      scrollTop: scroll.scrollTop,
      scrollMax: scroll.scrollHeight - scroll.clientHeight,
      inputScrollable: input.scrollHeight - input.clientHeight,
      caretGlyphGap: before,
      gapShiftOnScroll,
      lastLineOffset: glyphTop(last) - box.top,
      firstLineOffset: glyphTop(first) - box.top,
    }
  }, { first: FIRST_MARKER, last: LAST_MARKER })
}

/**
 * Render the golden body.
 *
 * Absolute glyph coordinates are deliberately absent: they depend on font
 * metrics and would make the fixture fail on a machine that measures text
 * differently — a golden that needs re-recording per platform documents the
 * platform, not the behavior. What is recorded is the cap, the caret-to-glyph
 * relation, and which lines are on screen, each a comparison that survives any
 * layout keeping the coupling.
 * @param top - metrics with the draft scrolled to its start.
 * @param bottom - metrics with the draft scrolled to its end.
 * @param trailingNewline - metrics with the trailing-newline draft scrolled to its end.
 * @param pasted - metrics right after a long block was pasted at the draft's end.
 * @returns the golden body, without a trailing newline.
 */
function renderGeometry(
  top: ComposerMetrics, bottom: ComposerMetrics, trailingNewline: ComposerMetrics, pasted: ComposerMetrics,
): string {
  return [
    '# Composer draft scrolling (14-line cap, two text layers, one scrollport)',
    '',
    '## At the start of the draft',
    '',
    `- draft overflows the capped box: ${String(top.overflows)}`,
    `- visible lines: ${String(top.visibleLines)}`,
    `- the textarea holds no scroll offset of its own: ${String(top.inputScrollable === 0)}`,
    `- all three layers wrap at one width: ${String(
      top.inputWrapWidth === top.backdropWrapWidth && top.backdropWrapWidth === top.mirrorWrapWidth,
    )}`,
    `- scroll offset: ${String(top.scrollTop)}px`,
    `- caret and glyphs stay level when the offset changes: ${String(top.gapShiftOnScroll === 0)}`,
    `- first draft line is on screen: ${String(top.firstLineOffset >= 0 && top.firstLineOffset < top.clientHeight)}`,
    `- last draft line is on screen: ${String(top.lastLineOffset >= 0 && top.lastLineOffset < top.clientHeight)}`,
    '',
    '## Scrolled to the end of the draft',
    '',
    `- offset moved: ${String(bottom.scrollTop > 0)}`,
    `- caret sits on its own glyphs: ${String(bottom.caretGlyphGap === top.caretGlyphGap)}`,
    `- caret and glyphs stay level when the offset changes: ${String(bottom.gapShiftOnScroll === 0)}`,
    `- first draft line has scrolled out above: ${String(bottom.firstLineOffset < 0)}`,
    `- last draft line is on screen: ${String(bottom.lastLineOffset >= 0 && bottom.lastLineOffset < bottom.clientHeight)}`,
    '',
    '## Draft ending in a newline, scrolled to the end',
    '',
    `- caret sits on its own glyphs: ${String(trailingNewline.caretGlyphGap === top.caretGlyphGap)}`,
    `- the draft's own last line is on screen: ${String(
      trailingNewline.lastLineOffset >= 0 && trailingNewline.lastLineOffset < trailingNewline.clientHeight,
    )}`,
    '',
    '## Right after pasting a long block at the end',
    '',
    `- the composer scrolled to the caret it left: ${String(pasted.scrollTop > 0)}`,
    `- caret and glyphs stay level when the offset changes: ${String(pasted.gapShiftOnScroll === 0)}`,
    `- the pasted block's last line is on screen: ${String(
      pasted.lastLineOffset >= 0 && pasted.lastLineOffset < pasted.clientHeight,
    )}`,
  ].join('\n').trimEnd()
}

describe('web e2e: composer draft scrolling', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd, 'composer-draft-scroll')
    await page.locator('textarea:enabled').first().fill(DRAFT)
  }, 180_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('caps the draft box and keeps both text layers at the start', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-composer-draft-scroll-top'))
    // Vacuity guard: without an overflowing draft there is nothing to scroll and
    // every assertion below holds trivially.
    await expect.poll(async () => (await measureComposer(page)).overflows, { timeout: 10_000 }).toBe(true)
    // Typing the draft left the caret — and the box — at its end, so reach the
    // start by the same gesture a user would, and leave it there for the wheel
    // case below.
    await page.locator('textarea:enabled').first().hover()
    await page.mouse.wheel(0, -2000)
    await expect.poll(async () => (await measureComposer(page)).scrollTop, { timeout: 10_000 }).toBe(0)
    const metrics = await measureComposer(page)
    // The cap is the composer seat's `--dsh-composer-text-max-height` (336px =
    // 14 x 24px lines). The count, not the pixels: it is the figma constant and
    // survives a device-pixel-ratio change.
    expect(metrics.visibleLines).toBe(14)
    // One scrolling box: the textarea is as tall as the draft, so there is no
    // second offset for the caret to hold while the glyphs hold another.
    expect(metrics.inputScrollable).toBe(0)
    expect(metrics.scrollTop).toBe(0)
    expect(metrics.firstLineOffset).toBeGreaterThanOrEqual(0)
    expect(metrics.firstLineOffset).toBeLessThan(metrics.clientHeight)
    expect(metrics.lastLineOffset).toBeGreaterThan(metrics.clientHeight)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('lays out all three text layers at one wrap width', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-composer-draft-scroll-wrap-width'))
    // A layer that breaks lines somewhere else puts the words under the wrong
    // caret, and an 8px difference is worth 2 to 5 lines on a wrap-sensitive
    // draft. All three share a containing block — the scrollport — so a
    // scrollbar that consumes layout space costs them the same width; with
    // only the textarea scrolling, WebKit reserves gutter space for it alone
    // (768 against 776) while chromium and firefox do not.
    const metrics = await measureComposer(page)
    expect(metrics.backdropWrapWidth).toBe(metrics.inputWrapWidth)
    // The mirror decides the box height, so it belongs in the same equality —
    // were it alone to wrap wider, the box would be measured too short and
    // clip content before the 14-line cap, with every other assertion green.
    expect(metrics.mirrorWrapWidth).toBe(metrics.inputWrapWidth)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('the glyphs cannot lag the caret: one task moves both', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-composer-draft-scroll-lag'))
    // The reported symptom, isolated. A scroll offset changes and the caret's
    // distance to its own glyphs is re-read before the task ends — before any
    // `scroll` listener could have run. With the layers on one scrollport the
    // browser moves both, so the distance is unchanged; with the glyph layer
    // catching up in a listener it is off by the whole delta until a later
    // frame, which is a caret flying away from its text mid-gesture.
    const metrics = await measureComposer(page)
    expect(metrics.gapShiftOnScroll).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('a wheel gesture over a long draft moves the words, not only the caret', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-composer-draft-scroll-wheel'))
    const input = page.locator('textarea:enabled').first()
    await input.hover()
    const resting = (await measureComposer(page)).caretGlyphGap
    // One delta past the whole draft: the box clamps at its own end, and the
    // wheel-chaining handler leaves it native because the box is not yet at its
    // edge when the gesture starts (the chaining itself is owned by the unit spec).
    await page.mouse.wheel(0, 2000)
    await expect.poll(async () => (await measureComposer(page)).scrollTop, { timeout: 10_000 })
      .toBeGreaterThan(0)
    const metrics = await measureComposer(page)
    // The caret is still on its own glyphs after the gesture.
    expect(metrics.caretGlyphGap).toBe(resting)
    // The reported symptom, stated as what the user sees: the end of the draft
    // is on screen and its beginning is not.
    expect(metrics.lastLineOffset).toBeGreaterThanOrEqual(0)
    expect(metrics.lastLineOffset).toBeLessThan(metrics.clientHeight)
    expect(metrics.firstLineOffset).toBeLessThan(0)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('typing at the end of a scrolled draft brings the caret back into view', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-composer-draft-scroll-edit'))
    // The other way the box moves, and the one that depends on the browser: the
    // textarea holds no scroll offset of its own, so revealing the caret after
    // an edit is a scroll-into-view that has to walk up to the scrollport.
    // Scroll away from the caret first, so the edit has somewhere to bring it
    // back from.
    const input = page.locator('textarea:enabled').first()
    await input.press('End')
    await input.hover()
    await page.mouse.wheel(0, -2000)
    await expect.poll(async () => (await measureComposer(page)).scrollTop, { timeout: 10_000 }).toBe(0)
    await input.pressSequentially(' tail')
    const metrics = await measureComposer(page)
    expect(metrics.scrollTop).toBeGreaterThan(0)
    expect(metrics.lastLineOffset).toBeGreaterThanOrEqual(0)
    expect(metrics.lastLineOffset).toBeLessThan(metrics.clientHeight)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('pasting a long block scrolls to the caret it leaves at the end', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-composer-draft-scroll-paste'))
    // The composer suppresses the native paste — the machine owns the draft and
    // the undo log — and restores the caret programmatically, which reveals
    // nothing on its own: in chromium and WebKit the view stays put while the
    // caret sits at the end of the pasted block, so the restore scrolls it
    // into view; this case pins it.
    const input = page.locator('textarea:enabled').first()
    await input.fill('one short line')
    await input.press('End')
    // A real `paste` event carrying real clipboard data, dispatched at the
    // textarea: the same event a Cmd-V delivers, and it runs the same handler.
    await input.evaluate((el, text) => {
      const data = new DataTransfer()
      data.setData('text/plain', text)
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
      // The engines disagree when the draft ends in a newline: the caret
      // lands on a line with nothing on it, where chromium reports no client
      // rects at all for the collapsed position.
    }, `\n${DRAFT}\n`)
    await expect.poll(async () => (await measureComposer(page)).overflows, { timeout: 10_000 }).toBe(true)
    // The restore lands one frame after the machine commits the draft, so the
    // box overflows before it moves; waiting on the offset is waiting for the
    // behavior itself, and its absence fails this poll.
    await expect.poll(async () => (await measureComposer(page)).scrollTop, { timeout: 10_000 }).toBeGreaterThan(0)
    const metrics = await measureComposer(page)
    // The caret is at the end of what was pasted, so the draft's last line is
    // what has to be on screen.
    expect(metrics.lastLineOffset).toBeGreaterThanOrEqual(0)
    expect(metrics.lastLineOffset).toBeLessThan(metrics.clientHeight)
    expect(metrics.gapShiftOnScroll).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('a draft ending in a newline scrolls to its true end, not a line above it', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-composer-draft-scroll-trailing-newline'))
    // The layers reserve a final line box on different terms, so the trailing-newline case is
    // the one that separates a height every layer agrees on from a box measured
    // one line short of the caret's own last position.
    const input = page.locator('textarea:enabled').first()
    await input.fill(DRAFT_TRAILING_NEWLINE)
    await expect.poll(async () => (await measureComposer(page)).overflows, { timeout: 10_000 }).toBe(true)
    await input.hover()
    await page.mouse.wheel(0, 4000)
    await expect.poll(async () => {
      const m = await measureComposer(page)
      return m.scrollTop === m.scrollMax
    }, { timeout: 10_000 }).toBe(true)
    const bottom = await measureComposer(page)
    // At the very bottom the glyphs are level with the caret, and the draft's
    // own last line — the one before the empty final line — is on screen.
    expect(bottom.gapShiftOnScroll).toBe(0)
    expect(bottom.lastLineOffset).toBeGreaterThanOrEqual(0)
    expect(bottom.lastLineOffset).toBeLessThan(bottom.clientHeight)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('matches the committed composer scroll geometry golden', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-composer-draft-scroll-golden'))
    const input = page.locator('textarea:enabled').first()
    // Restore the pristine draft (the edit case appended to it) and return to
    // its start, both through ordinary gestures.
    await input.fill(DRAFT)
    await input.hover()
    await page.mouse.wheel(0, -2000)
    await expect.poll(async () => (await measureComposer(page)).scrollTop, { timeout: 10_000 }).toBe(0)
    const top = await measureComposer(page)
    await input.hover()
    await page.mouse.wheel(0, 2000)
    await expect.poll(async () => (await measureComposer(page)).scrollTop, { timeout: 10_000 })
      .toBeGreaterThan(0)
    const bottom = await measureComposer(page)
    await input.fill(DRAFT_TRAILING_NEWLINE)
    await input.hover()
    await page.mouse.wheel(0, 4000)
    await expect.poll(async () => {
      const m = await measureComposer(page)
      return m.scrollTop === m.scrollMax
    }, { timeout: 10_000 }).toBe(true)
    const trailingNewline = await measureComposer(page)
    // The paste path, measured the way a user meets it: a short draft, the
    // caret at its end, one long block pasted in.
    await input.fill('one short line')
    await input.press('End')
    await input.evaluate((el, text) => {
      const data = new DataTransfer()
      data.setData('text/plain', text)
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
      // The ordinary case, without a trailing newline, so the collapsed branch
      // of the reveal keeps a real engine under it; the case above owns the
      // after-newline branch.
    }, `\n${DRAFT}`)
    await expect.poll(async () => (await measureComposer(page)).overflows, { timeout: 10_000 }).toBe(true)
    await expect.poll(async () => (await measureComposer(page)).scrollTop, { timeout: 10_000 }).toBeGreaterThan(0)
    const pasted = await measureComposer(page)
    await compareOrRefreshGolden(GEOMETRY_EXPECTED, renderGeometry(top, bottom, trailingNewline, pasted), MODE)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('commits exactly the fixtures it reads', async () => {
    // Zero model calls, so the scenario records no session fixture: the geometry
    // golden is the whole inventory.
    await assertFixtureInventory(SNAPSHOT_DIR, ['geometry.expected.md'])
  })

  it.skipIf(MODE === 'record')('issued zero model calls and stayed clean', () => {
    expect(tripwire.warnings).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
  })
})
