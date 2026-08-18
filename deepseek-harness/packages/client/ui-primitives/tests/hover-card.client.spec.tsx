// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HoverCard } from '@deepseek-ai/dsh-client-ui-primitives'
import { POINTER_GRACE_MS } from '../src/pointer-grace.ts'

afterEach(cleanup)
beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

/** Anchor wrapper rect: the card positions from this (jsdom rects are all-zero by default). */
function stubAnchorRect(anchor: HTMLElement, rect: { top: number; right: number }): void {
  const wrapper = anchor.parentElement as HTMLElement
  wrapper.getBoundingClientRect = () => ({
    top: rect.top, right: rect.right, left: rect.right - 100, bottom: rect.top + 34,
    width: 100, height: 34, x: rect.right - 100, y: rect.top, toJSON: () => ({}),
  })
}

function mount(props: {
  openDelayMs?: number
  disabled?: boolean
  copyText?: string
  copyLabel?: string
  copiedLabel?: string
} = {}) {
  const view = render(
    <HoverCard anchor={<span>row</span>} content={<div>card body</div>} {...props} />,
  )
  const anchor = screen.getByText('row')
  stubAnchorRect(anchor, { top: 40, right: 200 })
  return { view, anchor, wrapper: anchor.parentElement as HTMLElement }
}

/** Install the async browser clipboard and restore its prior host shape. */
function installClipboard(writeText: (text: string) => Promise<void>): () => void {
  const prior = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
  return () => {
    if (prior === undefined) Reflect.deleteProperty(navigator, 'clipboard')
    else Object.defineProperty(navigator, 'clipboard', prior)
  }
}

describe('HoverCard', () => {
  it('opens after the dwell delay, positioned right of the anchor', () => {
    const { wrapper } = mount()
    fireEvent.pointerEnter(wrapper)
    expect(screen.queryByText('card body')).toBeNull()
    act(() => { vi.advanceTimersByTime(499) })
    expect(screen.queryByText('card body')).toBeNull()
    act(() => { vi.advanceTimersByTime(1) })
    const card = screen.getByText('card body').parentElement as HTMLElement
    expect(card.parentElement).toBe(document.body)
    expect(card.style.left).toBe('208px')
    expect(card.style.top).toBe('40px')
  })

  it('honors a custom openDelayMs', () => {
    const { wrapper } = mount({ openDelayMs: 50 })
    fireEvent.pointerEnter(wrapper)
    act(() => { vi.advanceTimersByTime(50) })
    expect(screen.getByText('card body')).toBeTruthy()
  })

  it('pointerleave before the delay cancels the pending open', () => {
    const { wrapper } = mount()
    fireEvent.pointerEnter(wrapper)
    fireEvent.pointerLeave(wrapper)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.queryByText('card body')).toBeNull()
  })

  it('pointerleave closes an open card a grace later; re-enter after that restarts the dwell', () => {
    const { wrapper } = mount()
    fireEvent.pointerEnter(wrapper)
    act(() => { vi.advanceTimersByTime(500) })
    expect(screen.getByText('card body')).toBeTruthy()
    fireEvent.pointerLeave(wrapper)
    act(() => { vi.advanceTimersByTime(POINTER_GRACE_MS - 1) })
    expect(screen.getByText('card body')).toBeTruthy()
    act(() => { vi.advanceTimersByTime(1) })
    expect(screen.queryByText('card body')).toBeNull()
    fireEvent.pointerEnter(wrapper)
    act(() => { vi.advanceTimersByTime(500) })
    expect(screen.getByText('card body')).toBeTruthy()
  })

  it('reaching the card inside the grace keeps it open without restarting the dwell', () => {
    // The portaled card is a React child of the wrapper, so the pointer
    // arriving on it re-enters the wrapper — the gesture an anchor gap
    // would make impossible.
    const { wrapper } = mount()
    fireEvent.pointerEnter(wrapper)
    act(() => { vi.advanceTimersByTime(500) })
    fireEvent.pointerLeave(wrapper)
    act(() => { vi.advanceTimersByTime(POINTER_GRACE_MS - 50) })
    fireEvent.pointerEnter(wrapper)
    act(() => { vi.advanceTimersByTime(POINTER_GRACE_MS * 10) })
    expect(screen.getByText('card body')).toBeTruthy()
  })

  it('re-entering while open does not queue a second dwell', () => {
    const { wrapper } = mount()
    fireEvent.pointerEnter(wrapper)
    act(() => { vi.advanceTimersByTime(500) })
    fireEvent.pointerEnter(wrapper)
    fireEvent.pointerLeave(wrapper)
    act(() => { vi.advanceTimersByTime(POINTER_GRACE_MS) })
    // A dwell restarted by the redundant enter would reopen the card here.
    act(() => { vi.advanceTimersByTime(500) })
    expect(screen.queryByText('card body')).toBeNull()
  })

  it('a press inside the anchor dismisses the card without waiting for disabled', () => {
    const { wrapper } = mount()
    fireEvent.pointerEnter(wrapper)
    act(() => { vi.advanceTimersByTime(500) })
    expect(screen.getByText('card body')).toBeTruthy()
    fireEvent.pointerDown(screen.getByText('row'))
    expect(screen.queryByText('card body')).toBeNull()
    // The pending timer is also cleared: no reopen after the dwell.
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.queryByText('card body')).toBeNull()
  })

  it('a press on the card starts a selection instead of dismissing it', () => {
    // The card is a React child of the wrapper, so capture-phase presses on
    // it reach the wrapper's dismissal handler too; they must not close it,
    // or the first pointerdown of a text-selection drag would kill the card.
    const { wrapper } = mount()
    fireEvent.pointerEnter(wrapper)
    act(() => { vi.advanceTimersByTime(500) })
    fireEvent.pointerDown(screen.getByText('card body'))
    // Still mounted after a grace's worth of time: no close was armed either.
    act(() => { vi.advanceTimersByTime(POINTER_GRACE_MS) })
    expect(screen.getByText('card body')).toBeTruthy()
  })

  it('keeps a completed card selection instead of treating its click as copy', async () => {
    const writeText = vi.fn(async () => {})
    const restoreClipboard = installClipboard(writeText)
    const selection = window.getSelection()
    if (selection === null) throw new Error('jsdom selection API unavailable')
    try {
      const { wrapper } = mount({ copyText: 'card body', copyLabel: 'Copy' })
      fireEvent.pointerEnter(wrapper)
      act(() => { vi.advanceTimersByTime(500) })
      const card = screen.getByRole('button', { name: 'Copy: card body' })
      const selectedText = screen.getByText('card body')
      const cardRange = document.createRange()
      cardRange.selectNodeContents(selectedText)
      selection.addRange(cardRange)
      await act(async () => { fireEvent.click(card) })
      expect(writeText).not.toHaveBeenCalled()
      expect(selection.toString()).toBe('card body')
      expect(screen.getByText('card body')).toBeTruthy()

      // Firefox supports multiple selection ranges: any range intersecting
      // this card wins, not only the first.
      selection.removeAllRanges()
      const getSelection = vi.spyOn(window, 'getSelection').mockReturnValue({
        isCollapsed: false,
        rangeCount: 2,
        getRangeAt: vi.fn((index: number) => ({
          intersectsNode: () => index === 1,
        })),
      } as unknown as Selection)
      await act(async () => { fireEvent.click(card) })
      expect(writeText).not.toHaveBeenCalled()
      getSelection.mockRestore()

      // A non-collapsed selection elsewhere does not block this card.
      const anchorRange = document.createRange()
      anchorRange.selectNodeContents(screen.getByText('row'))
      selection.addRange(anchorRange)
      await act(async () => { fireEvent.click(card) })
      expect(writeText).toHaveBeenCalledWith('card body')
    } finally {
      selection.removeAllRanges()
      restoreClipboard()
    }
  })

  it('a press while closed leaves the card closed', () => {
    mount()
    fireEvent.pointerDown(screen.getByText('row'))
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.queryByText('card body')).toBeNull()
  })

  it('copies its configured value and shows success only for the feedback window', async () => {
    const writeText = vi.fn(async () => {})
    const restoreClipboard = installClipboard(writeText)
    try {
      const { wrapper } = mount({
        copyText: '/full/path',
        copyLabel: 'Copy path',
        copiedLabel: 'Copied',
      })
      fireEvent.pointerEnter(wrapper)
      act(() => { vi.advanceTimersByTime(500) })
      const card = screen.getByRole('button', { name: 'Copy path: /full/path' })
      const status = screen.getByRole('status')
      expect(status.textContent).toBe('')
      expect(card.contains(status)).toBe(false)
      Object.defineProperty(card, 'offsetHeight', { configurable: true, value: 96 })
      await act(async () => { fireEvent.click(card) })
      expect(writeText).toHaveBeenCalledWith('/full/path')
      expect(status.textContent).toBe('Copied')
      expect(screen.getByRole('button', { name: 'Copy path: /full/path' })).toBe(card)
      expect(card.style.minHeight).toBe('96px')
      // Repeated activation while feedback is visible neither rewrites nor
      // extends the one-second success window.
      await act(async () => { fireEvent.click(card) })
      expect(writeText).toHaveBeenCalledOnce()
      act(() => { vi.advanceTimersByTime(999) })
      expect(status.textContent).toBe('Copied')
      act(() => { vi.advanceTimersByTime(1) })
      expect(screen.getByRole('button', { name: 'Copy path: /full/path' })).toBe(card)
      expect(card.style.minHeight).toBe('')
      expect(status.textContent).toBe('')
      expect(screen.getByText('card body')).toBeTruthy()
    } finally {
      restoreClipboard()
    }
  })

  it('supports button keys and ignores unrelated keys', async () => {
    const writeText = vi.fn(async () => {})
    const restoreClipboard = installClipboard(writeText)
    try {
      const { wrapper } = mount({ copyText: 'value', copiedLabel: 'Copied' })
      fireEvent.pointerEnter(wrapper)
      act(() => { vi.advanceTimersByTime(500) })
      const card = screen.getByRole('button')
      fireEvent.keyDown(card, { key: 'Escape' })
      expect(writeText).not.toHaveBeenCalled()
      await act(async () => { fireEvent.keyDown(card, { key: 'Enter' }) })
      expect(writeText).toHaveBeenCalledOnce()
      act(() => { vi.advanceTimersByTime(1000) })
      await act(async () => { fireEvent.keyDown(card, { key: ' ' }) })
      expect(writeText).toHaveBeenCalledTimes(2)
    } finally {
      restoreClipboard()
    }
  })

  it('keeps its content when the clipboard rejects the write', async () => {
    const writeText = vi.fn(async () => { throw new Error('denied') })
    const restoreClipboard = installClipboard(writeText)
    try {
      const { wrapper } = mount({ copyText: 'value', copiedLabel: 'Copied' })
      fireEvent.pointerEnter(wrapper)
      act(() => { vi.advanceTimersByTime(500) })
      await act(async () => { fireEvent.click(screen.getByRole('button')) })
      expect(screen.queryByText('Copied')).toBeNull()
      expect(screen.getByText('card body')).toBeTruthy()
    } finally {
      restoreClipboard()
    }
  })

  it('unmount clears copied feedback', async () => {
    const writeText = vi.fn(async () => {})
    const restoreClipboard = installClipboard(writeText)
    try {
      const { view, wrapper } = mount({ copyText: 'value' })
      fireEvent.pointerEnter(wrapper)
      act(() => { vi.advanceTimersByTime(500) })
      await act(async () => { fireEvent.click(screen.getByRole('button')) })
      expect(vi.getTimerCount()).toBe(1)
      view.unmount()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      restoreClipboard()
    }
  })

  it('clears copied feedback when the card closes', async () => {
    const writeText = vi.fn(async () => {})
    const restoreClipboard = installClipboard(writeText)
    try {
      const { wrapper } = mount({ copyText: 'value', copiedLabel: 'Copied' })
      fireEvent.pointerEnter(wrapper)
      act(() => { vi.advanceTimersByTime(500) })
      await act(async () => { fireEvent.click(screen.getByRole('button')) })
      expect(screen.getByRole('status').textContent).toBe('Copied')
      fireEvent.pointerLeave(wrapper)
      act(() => { vi.advanceTimersByTime(POINTER_GRACE_MS) })
      expect(screen.queryByText('Copied')).toBeNull()
      fireEvent.pointerEnter(wrapper)
      act(() => { vi.advanceTimersByTime(500) })
      expect(screen.getByText('card body')).toBeTruthy()
    } finally {
      restoreClipboard()
    }
  })

  it('does not create copied feedback after an in-flight write unmounts', async () => {
    let acceptWrite: (() => void) | undefined
    const writeText = vi.fn(() => new Promise<void>((resolve) => { acceptWrite = resolve }))
    const restoreClipboard = installClipboard(writeText)
    try {
      const { view, wrapper } = mount({ copyText: 'value' })
      fireEvent.pointerEnter(wrapper)
      act(() => { vi.advanceTimersByTime(500) })
      fireEvent.click(screen.getByRole('button'))
      expect(writeText).toHaveBeenCalledOnce()
      view.unmount()
      await act(async () => { acceptWrite?.() })
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      restoreClipboard()
    }
  })

  it('does not restore copied feedback after an in-flight card closes', async () => {
    let acceptWrite: (() => void) | undefined
    const writeText = vi.fn(() => new Promise<void>((resolve) => { acceptWrite = resolve }))
    const restoreClipboard = installClipboard(writeText)
    try {
      const { wrapper } = mount({ copyText: 'value', copiedLabel: 'Copied' })
      fireEvent.pointerEnter(wrapper)
      act(() => { vi.advanceTimersByTime(500) })
      fireEvent.click(screen.getByRole('button'))
      fireEvent.pointerLeave(wrapper)
      act(() => { vi.advanceTimersByTime(POINTER_GRACE_MS) })
      fireEvent.pointerEnter(wrapper)
      act(() => { vi.advanceTimersByTime(500) })
      await act(async () => { acceptWrite?.() })
      expect(vi.getTimerCount()).toBe(0)
      expect(screen.getByText('card body')).toBeTruthy()
    } finally {
      restoreClipboard()
    }
  })

  it('coalesces activations while the clipboard write is in flight', async () => {
    let acceptWrite: (() => void) | undefined
    const writeText = vi.fn(() => new Promise<void>((resolve) => { acceptWrite = resolve }))
    const restoreClipboard = installClipboard(writeText)
    try {
      const { wrapper } = mount({ copyText: 'value', copiedLabel: 'Copied' })
      fireEvent.pointerEnter(wrapper)
      act(() => { vi.advanceTimersByTime(500) })
      const card = screen.getByRole('button')
      fireEvent.click(card)
      fireEvent.click(card)
      expect(writeText).toHaveBeenCalledOnce()
      await act(async () => { acceptWrite?.() })
      expect(screen.getByRole('status').textContent).toBe('Copied')
    } finally {
      restoreClipboard()
    }
  })

  it('disabled suppresses opening entirely', () => {
    const { wrapper } = mount({ disabled: true })
    fireEvent.pointerEnter(wrapper)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.queryByText('card body')).toBeNull()
  })

  it('flipping disabled true closes an open card', () => {
    const { view, wrapper } = mount()
    fireEvent.pointerEnter(wrapper)
    act(() => { vi.advanceTimersByTime(500) })
    expect(screen.getByText('card body')).toBeTruthy()
    view.rerender(<HoverCard anchor={<span>row</span>} content={<div>card body</div>} disabled />)
    expect(screen.queryByText('card body')).toBeNull()
  })

  it('corrects the bottom-edge clamp once the mounted card height is measurable', () => {
    // First placement reads height 0 (card not yet mounted) and keeps the
    // anchor top; the post-mount correction re-clamps with the real height.
    window.innerHeight = 300
    const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 120 })
    try {
      const { wrapper } = mount()
      stubAnchorRect(screen.getByText('row'), { top: 280, right: 200 })
      fireEvent.pointerEnter(wrapper)
      act(() => { vi.advanceTimersByTime(500) })
      const card = screen.getByText('card body').parentElement as HTMLElement
      // 300 - 120 - 8 = 172, instead of the anchor top 280.
      expect(card.style.top).toBe('172px')
    } finally {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight)
    }
  })

  it('clamps inside placement itself when the card is already measured (resize path)', () => {
    window.innerHeight = 300
    const { wrapper } = mount()
    stubAnchorRect(screen.getByText('row'), { top: 280, right: 200 })
    fireEvent.pointerEnter(wrapper)
    act(() => { vi.advanceTimersByTime(500) })
    const card = screen.getByText('card body').parentElement as HTMLElement
    Object.defineProperty(card, 'offsetHeight', { value: 120 })
    act(() => { fireEvent.resize(window) })
    expect(card.style.top).toBe('172px')
  })

  it('repositions on capture-phase scroll while open and stops listening after close', () => {
    const { wrapper } = mount()
    fireEvent.pointerEnter(wrapper)
    act(() => { vi.advanceTimersByTime(500) })
    stubAnchorRect(screen.getByText('row'), { top: 90, right: 300 })
    act(() => { fireEvent.scroll(document) })
    const card = screen.getByText('card body').parentElement as HTMLElement
    expect(card.style.left).toBe('308px')
    expect(card.style.top).toBe('90px')
    fireEvent.pointerLeave(wrapper)
    act(() => { vi.advanceTimersByTime(POINTER_GRACE_MS) })
    expect(screen.queryByText('card body')).toBeNull()
  })

  it('unmount clears a pending open timer', () => {
    const { view, wrapper } = mount()
    fireEvent.pointerEnter(wrapper)
    view.unmount()
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.queryByText('card body')).toBeNull()
  })
})
