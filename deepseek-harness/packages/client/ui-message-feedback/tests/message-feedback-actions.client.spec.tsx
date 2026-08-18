// @vitest-environment jsdom
/**
 * MessageFeedbackActions rendering and gestures: the rating buttons reflect the
 * shared view, re-clicking the active rating retracts it, the note editor
 * saves through the same rate verb, the Session's feedback is read on first
 * interaction rather than on mount, and a rejected mutation surfaces inline
 * without losing the authoritative state.
 */
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { MessageId } from '@deepseek-ai/dsh-client-connection/client'
import type {
  MessageFeedbackItem, MessageFeedbackRating, MessageFeedbackVersion,
} from '@deepseek-ai/dsh-message-feedback/types'
import { MessageFeedbackActions } from '../src/client/MessageFeedbackActions.tsx'
import type { MessageFeedbackActionResult, MessageFeedbackView } from '../src/client/controller.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const MSG = 'm-1' as MessageId
const t = makeTranslate(zh, commonZh)

function item(overrides: Partial<MessageFeedbackItem> = {}): MessageFeedbackItem {
  return {
    messageId: MSG,
    rating: 'positive',
    version: 'v1' as MessageFeedbackVersion,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

/** Render the controls over a fixed view and recording verbs. */
function mount(options: {
  current?: MessageFeedbackItem | undefined
  rateResult?: MessageFeedbackActionResult
  clearResult?: MessageFeedbackActionResult
  status?: MessageFeedbackView['status']
} = {}) {
  const view: MessageFeedbackView = {
    status: options.status ?? 'ready',
    items: new Map(options.current === undefined ? [] : [[MSG, options.current]]),
    error: null,
  }
  const ensure = vi.fn(() => Promise.resolve<MessageFeedbackActionResult>({ ok: true }))
  const rate = vi.fn((_id: MessageId, _rating: MessageFeedbackRating, _note?: string) =>
    Promise.resolve(options.rateResult ?? { ok: true as const }))
  const clear = vi.fn((_id: MessageId) =>
    Promise.resolve(options.clearResult ?? { ok: true as const }))
  // The controller owns retract-vs-replace, so the double stands in for it:
  // matching the shown rating retracts, anything else replaces.
  const toggle = vi.fn((id: MessageId, next: MessageFeedbackRating) =>
    (options.current?.rating === next ? clear(id) : rate(id, next)))
  const clearNote = vi.fn((_id: MessageId) =>
    Promise.resolve(options.rateResult ?? { ok: true as const }))
  const useFeedback = (<T,>(select: (v: MessageFeedbackView) => T): T =>
    useSyncExternalStore(() => () => {}, () => select(view))) as never
  const props = { messageId: MSG, ensure, rate, toggle, clearNote, clear, useFeedback, t } as unknown as
    Parameters<typeof MessageFeedbackActions>[0]
  return { ...render(<MessageFeedbackActions {...props} />), ensure, rate, clear, toggle, clearNote }
}

describe('MessageFeedbackActions', () => {
  it('renders both rating buttons unpressed with no recorded feedback', () => {
    const ui = mount()

    expect(ui.getByLabelText(zh['action.like']).getAttribute('aria-pressed')).toBe('false')
    expect(ui.getByLabelText(zh['action.dislike']).getAttribute('aria-pressed')).toBe('false')
  })

  it('marks the recorded rating pressed and offers to retract it', () => {
    const ui = mount({ current: item({ rating: 'negative' }) })

    expect(ui.getByLabelText(zh['action.dislikeActive']).getAttribute('aria-pressed')).toBe('true')
    expect(ui.getByLabelText(zh['action.like']).getAttribute('aria-pressed')).toBe('false')
  })

  it('reads the Session feedback on first interaction, once', () => {
    const ui = mount()
    const like = ui.getByLabelText(zh['action.like'])

    fireEvent.pointerEnter(like)
    fireEvent.pointerEnter(like)
    fireEvent.focus(ui.getByLabelText(zh['action.dislike']))

    expect(ui.ensure).toHaveBeenCalledTimes(1)
  })

  it('does not read the Session feedback on mount', () => {
    const ui = mount()

    expect(ui.ensure).not.toHaveBeenCalled()
  })

  it('rates a message that has no feedback yet', async () => {
    const ui = mount()

    fireEvent.click(ui.getByLabelText(zh['action.like']))

    await waitFor(() => { expect(ui.toggle).toHaveBeenCalledWith(MSG, 'positive') })
    expect(ui.clear).not.toHaveBeenCalled()
  })

  it('replaces the opposite rating and carries the existing note forward', async () => {
    const ui = mount({ current: item({ rating: 'positive', note: 'keep me' }) })

    fireEvent.click(ui.getByLabelText(zh['action.dislike']))

    await waitFor(() => { expect(ui.toggle).toHaveBeenCalledWith(MSG, 'negative') })
  })

  it('retracts the feedback when the active rating is clicked again', async () => {
    const ui = mount({ current: item({ rating: 'positive' }) })

    fireEvent.click(ui.getByLabelText(zh['action.likeActive']))

    await waitFor(() => { expect(ui.toggle).toHaveBeenCalledWith(MSG, 'positive') })
    // The double routes a matching rating to clear(), mirroring the controller.
    await waitFor(() => { expect(ui.clear).toHaveBeenCalledWith(MSG) })
  })

  it('saves a typed note through the rate verb and closes the editor', async () => {
    const ui = mount({ current: item({ rating: 'positive' }) })

    fireEvent.click(ui.getByText(zh['note.open']))
    fireEvent.change(ui.getByLabelText(zh['note.aria']), { target: { value: '  precise and short  ' } })
    fireEvent.click(ui.getByText(zh['note.save']))

    await waitFor(() => { expect(ui.rate).toHaveBeenCalledWith(MSG, 'positive', 'precise and short') })
    await waitFor(() => { expect(ui.queryByLabelText(zh['note.aria'])).toBeNull() })
  })

  it('clears the note when the editor is emptied', async () => {
    const ui = mount({ current: item({ rating: 'positive', note: 'old note' }) })

    fireEvent.click(ui.getByText('old note'))
    fireEvent.change(ui.getByLabelText(zh['note.aria']), { target: { value: '   ' } })
    fireEvent.click(ui.getByText(zh['note.save']))

    await waitFor(() => { expect(ui.clearNote).toHaveBeenCalledWith(MSG) })
  })

  it('seeds the editor with the recorded note and abandons it on cancel', () => {
    const ui = mount({ current: item({ rating: 'positive', note: 'old note' }) })

    fireEvent.click(ui.getByText('old note'))
    expect((ui.getByLabelText(zh['note.aria']) as HTMLTextAreaElement).value).toBe('old note')

    fireEvent.click(ui.getByText(zh['note.cancel']))
    expect(ui.queryByLabelText(zh['note.aria'])).toBeNull()
    expect(ui.rate).not.toHaveBeenCalled()
  })

  it('offers no note editor before a rating is recorded', () => {
    const ui = mount()

    expect(ui.queryByText(zh['note.open'])).toBeNull()
  })

  it('reports a lost race with the conflict copy', async () => {
    const ui = mount({
      rateResult: { ok: false, error: { code: 'version-conflict', message: 'feedback changed elsewhere' } },
    })

    fireEvent.click(ui.getByLabelText(zh['action.like']))

    await waitFor(() => { expect(ui.getByText(zh['error.conflict'])).toBeTruthy() })
  })

  it('reports any other failure with the generic copy', async () => {
    const ui = mount({
      rateResult: { ok: false, error: { code: 'target-not-found', message: 'no such message' } },
    })

    fireEvent.click(ui.getByLabelText(zh['action.like']))

    await waitFor(() => { expect(ui.getByText(zh['error.generic'])).toBeTruthy() })
  })

  it('keeps the editor open when the note fails to save', async () => {
    const ui = mount({
      current: item({ rating: 'positive' }),
      rateResult: { ok: false, error: { code: 'note-too-large', message: 'too long' } },
    })

    fireEvent.click(ui.getByText(zh['note.open']))
    fireEvent.change(ui.getByLabelText(zh['note.aria']), { target: { value: 'x'.repeat(20) } })
    fireEvent.click(ui.getByText(zh['note.save']))

    await waitFor(() => { expect(ui.getByText(zh['error.generic'])).toBeTruthy() })
    // The draft survives so the human can shorten it instead of retyping.
    expect(ui.getByLabelText(zh['note.aria'])).toBeTruthy()
  })

  it('publishes no state after the row unmounts mid-flight', async () => {
    let release = (): void => {}
    const gate = new Promise<MessageFeedbackActionResult>((resolve) => {
      release = () => { resolve({ ok: false, error: { code: 'target-not-found', message: 'gone' } }) }
    })
    const view: MessageFeedbackView = { status: 'ready', items: new Map(), error: null }
    const useFeedback = (<T,>(select: (v: MessageFeedbackView) => T): T =>
      useSyncExternalStore(() => () => {}, () => select(view))) as never
    const props = {
      messageId: MSG,
      ensure: vi.fn(() => Promise.resolve<MessageFeedbackActionResult>({ ok: true })),
      rate: vi.fn(() => gate),
      toggle: vi.fn(() => gate),
      clearNote: vi.fn(() => Promise.resolve<MessageFeedbackActionResult>({ ok: true })),
      clear: vi.fn(() => Promise.resolve<MessageFeedbackActionResult>({ ok: true })),
      useFeedback,
      t,
    } as unknown as Parameters<typeof MessageFeedbackActions>[0]
    const ui = render(<MessageFeedbackActions {...props} />)
    const errors: unknown[] = []
    const onError = (event: ErrorEvent): void => { errors.push(event.error) }
    window.addEventListener('error', onError)

    fireEvent.click(ui.getByLabelText(zh['action.like']))
    ui.unmount()
    release()
    await gate

    window.removeEventListener('error', onError)
    expect(errors).toEqual([])
  })

  it('surfaces a failed list load next to the controls', async () => {
    const ui = mount({ status: 'error' })

    expect(ui.getByText(zh['error.load'])).toBeTruthy()
  })

  it('prefers the action failure over the load notice', async () => {
    const ui = mount({
      status: 'error',
      rateResult: { ok: false, error: { code: 'target-not-found', message: 'gone' } },
    })

    fireEvent.click(ui.getByLabelText(zh['action.like']))

    await waitFor(() => { expect(ui.getByText(zh['error.generic'])).toBeTruthy() })
    expect(ui.queryByText(zh['error.load'])).toBeNull()
  })
})
