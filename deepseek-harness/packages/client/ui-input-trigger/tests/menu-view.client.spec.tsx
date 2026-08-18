// @vitest-environment jsdom
/**
 * MenuView rendering spec, props-direct: closed store
 * renders null, groups render in roster order under localized title rows
 * (unknown sources fall back to the raw name) with pending rows as loading,
 * pointer picks route (source, index) back without stealing focus, the
 * highlight is exposed through aria-activedescendant + aria-selected, and
 * the list height clamps to the space above the composer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { zh } from '../src/client/locales.ts'
import type { MenuState, TriggerHit } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { MenuView } from '../src/client/MenuView.tsx'

const hit: TriggerHit = {
  trigger: '/',
  query: 'g',
  position: 'leading',
  span: { start: 0, end: 2, draftRev: 1 },
}

const CLOSED: MenuState = { open: false, hit: null, generation: 0, groups: [], highlight: null }

function openState(partial?: Partial<MenuState>): MenuState {
  return {
    open: true,
    hit,
    generation: 1,
    groups: [
      { source: 'command', status: 'ready', items: [{ name: 'goal', description: 'Set up a goal', icon: '⚑' }, { name: 'plan' }] },
      { source: 'skill', status: 'pending', items: [] },
    ],
    highlight: { source: 'command', index: 0 },
    ...partial,
  }
}

// jsdom has no scrollIntoView; the view calls it on the highlighted option.
const scrollIntoView = vi.fn()
beforeEach(() => {
  Element.prototype.scrollIntoView = scrollIntoView
  scrollIntoView.mockClear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// The framework-injected t seat, stubbed over the zh dictionaries (the
// default locale); the stub mirrors the LocaleRuntime key fallback, so an
// unknown source comes back verbatim (its raw name).
const t = makeTranslate(zh, commonZh)

function mount(state: MenuState) {
  const menu = createSnapshotStore<MenuState>(state)
  const onPick = vi.fn()
  const onDismiss = vi.fn()
  const view = render(<MenuView menu={menu} onPick={onPick} onDismiss={onDismiss} t={t} />)
  return { menu, onPick, onDismiss, view }
}

/** The non-interactive group title rows (role=presentation), in document order. */
function titles(container: HTMLElement): string[] {
  return [...container.querySelectorAll('div[role="presentation"][data-source]')]
    .map(el => el.textContent ?? '')
}

describe('MenuView', () => {
  it('renders null while closed and appears when the store opens', () => {
    const { menu, view } = mount(CLOSED)
    expect(view.container.childElementCount).toBe(0)
    act(() => { menu.set(openState()) })
    expect(screen.queryByRole('listbox')).not.toBeNull()
    act(() => { menu.set(CLOSED) })
    expect(view.container.childElementCount).toBe(0)
  })

  it('renders ready groups as option rows and pending groups as loading rows', () => {
    mount(openState())
    const options = screen.getAllByRole('option')
    expect(options.map(o => o.textContent)).toEqual(['⚑goalSet up a goal', 'plan'])
    expect(screen.queryByText('正在加载…')).not.toBeNull()
  })

  it('titles each group with the localized source name, raw name for unknown sources, none for empty ready groups', () => {
    const { view } = mount(openState({
      groups: [
        { source: 'command', status: 'ready', items: [{ name: 'goal' }] },
        { source: 'hollow', status: 'ready', items: [] },
        { source: 'mystery', status: 'ready', items: [{ name: 'x' }] },
        { source: 'skill', status: 'pending', items: [] },
      ],
    }))
    expect(titles(view.container)).toEqual(['命令', 'mystery', '技能'])
  })

  it('exposes the highlight via aria-activedescendant and aria-selected', () => {
    mount(openState({ highlight: { source: 'command', index: 1 } }))
    const listbox = screen.getByRole('listbox')
    const options = screen.getAllByRole('option')
    expect(options[1]!.id).toBeTruthy()
    expect(listbox.getAttribute('aria-activedescendant')).toBe(options[1]!.id)
    expect(options[1]!.getAttribute('aria-selected')).toBe('true')
    expect(options[0]!.getAttribute('aria-selected')).toBe('false')
  })

  it('omits aria-activedescendant without a highlight', () => {
    mount(openState({ highlight: null }))
    expect(screen.getByRole('listbox').getAttribute('aria-activedescendant')).toBeNull()
  })

  it('scrolls the highlighted option into view when the highlight moves', () => {
    const { menu } = mount(openState())
    scrollIntoView.mockClear()
    act(() => { menu.set(openState({ highlight: { source: 'command', index: 1 } })) })
    const options = screen.getAllByRole('option')
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
    expect(scrollIntoView.mock.instances.at(-1)).toBe(options[1])
  })

  it('caps the list height at the design maximum when the composer sits low enough', () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ bottom: 800 } as DOMRect)
    mount(openState())
    expect(screen.getByRole('listbox').style.maxHeight).toBe('320px')
  })

  it('clamps the list height to the space above the composer minus the safe margin', () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ bottom: 200 } as DOMRect)
    mount(openState())
    expect(screen.getByRole('listbox').style.maxHeight).toBe('188px')
  })

  it('re-fits the height when the window resizes', () => {
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect')
    rect.mockReturnValue({ bottom: 800 } as DOMRect)
    mount(openState())
    expect(screen.getByRole('listbox').style.maxHeight).toBe('320px')
    rect.mockReturnValue({ bottom: 100 } as DOMRect)
    act(() => { window.dispatchEvent(new Event('resize')) })
    expect(screen.getByRole('listbox').style.maxHeight).toBe('88px')
  })

  it('pointerdown outside the menu (no composer card ancestor) dismisses', () => {
    const { onDismiss } = mount(openState())
    fireEvent.pointerDown(document.body)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('pointerdown inside the list does not dismiss', () => {
    const { onDismiss } = mount(openState())
    fireEvent.pointerDown(screen.getAllByRole('option')[0]!)
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('pointerdown inside the surrounding composer card does not dismiss; outside it does', () => {
    const menu = createSnapshotStore<MenuState>(openState())
    const onDismiss = vi.fn()
    render(
      <div data-composer-card="">
        <MenuView menu={menu} onPick={vi.fn()} onDismiss={onDismiss} t={t} />
        <button type="button" data-testid="composer-button" />
      </div>,
    )
    fireEvent.pointerDown(screen.getByTestId('composer-button'))
    expect(onDismiss).not.toHaveBeenCalled()
    fireEvent.pointerDown(document.body)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('ignores a pointerdown whose target is not a DOM node', () => {
    const { onDismiss } = mount(openState())
    const ev = new Event('pointerdown', { bubbles: true })
    Object.defineProperty(ev, 'target', { value: {} })
    document.dispatchEvent(ev)
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('closing the menu removes the dismiss listener', () => {
    const { menu, onDismiss } = mount(openState())
    act(() => { menu.set(CLOSED) })
    fireEvent.pointerDown(document.body)
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('mousedown on a row picks (source, index) and prevents the focus steal', () => {
    const { onPick } = mount(openState())
    const options = screen.getAllByRole('option')
    const notPrevented = fireEvent.mouseDown(options[1]!)
    // fireEvent returns false when preventDefault was called.
    expect(notPrevented).toBe(false)
    expect(onPick).toHaveBeenCalledWith('command', 1)
  })
})
