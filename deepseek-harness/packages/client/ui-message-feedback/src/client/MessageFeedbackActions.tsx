/**
 * Per-message feedback controls: a Like/Dislike pair plus an optional note.
 * Rendered inside the assistant message's IconActions row, so the buttons
 * reuse that row's chrome and sit between copy and branch.
 * @module @deepseek-ai/dsh-client-ui-message-feedback/client/MessageFeedbackActions
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  IconDislikeOutline16, IconLikeOutline16, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MessageFeedbackRating } from '@deepseek-ai/dsh-message-feedback/types'
import type { MessageFeedbackActionProps } from './slots.ts'
import css from './MessageFeedbackActions.module.css'

/**
 * One message's feedback controls.
 * @param props - the owner's message identity, the injected verbs, and the
 * shared feedback hook.
 * @returns the rating buttons, plus the note editor while it is open.
 */
export function MessageFeedbackActions({ messageId, ensure, rate, toggle, clearNote, useFeedback, t }: MessageFeedbackActionProps) {
  const item = useFeedback(view => view.items.get(messageId))
  const loadFailed = useFeedback(view => view.status === 'error')
  const rating = item?.rating
  const [noteOpen, setNoteOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  // The controls mount for every settled message in the transcript, so the
  // Session's feedback is read once on first hover/focus rather than on mount.
  const seeded = useRef(false)
  const seed = useCallback(() => {
    if (seeded.current) return
    seeded.current = true
    void ensure()
  }, [ensure])

  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  const settle = useCallback((result: { ok: boolean; error?: { code: string } }) => {
    if (!alive.current) return
    setPending(false)
    if (result.ok) {
      setFailure(null)
      return
    }
    setFailure(result.error?.code === 'version-conflict' ? t('error.conflict') : t('error.generic'))
  }, [t])

  const onRate = useCallback((next: MessageFeedbackRating) => {
    setPending(true)
    setFailure(null)
    // The controller decides retract-vs-replace from the committed item, so a
    // click that lands before the first list read still toggles the stored
    // value instead of this render's empty view.
    setNoteOpen(false)
    void toggle(messageId, next).then(settle)
  }, [messageId, settle, toggle])

  // The rating is a parameter because only the note editor's render site can
  // prove one is recorded; that removes an unreachable undefined guard here.
  const onSaveNote = useCallback((current: MessageFeedbackRating) => {
    const trimmed = draft.trim()
    setPending(true)
    setFailure(null)
    // An emptied editor removes the note explicitly; `rate` alone preserves a
    // stored note, so it cannot express deletion.
    const settled = trimmed.length === 0
      ? clearNote(messageId)
      : rate(messageId, current, trimmed)
    void settled.then((result) => {
      settle(result)
      if (result.ok && alive.current) setNoteOpen(false)
    })
  }, [clearNote, draft, messageId, rate, settle])

  const openNote = useCallback(() => {
    setDraft(item?.note ?? '')
    setNoteOpen(true)
  }, [item?.note])

  const likeLabel = rating === 'positive' ? t('action.likeActive') : t('action.like')
  const dislikeLabel = rating === 'negative' ? t('action.dislikeActive') : t('action.dislike')

  return (
    <>
      <Tooltip label={likeLabel} side="bottom">
        <button
          type="button"
          className={css.action}
          aria-label={likeLabel}
          aria-pressed={rating === 'positive'}
          data-active={rating === 'positive' || undefined}
          disabled={pending}
          onFocus={seed}
          onPointerEnter={seed}
          onClick={() => { onRate('positive') }}
        >
          <IconLikeOutline16 />
        </button>
      </Tooltip>
      <Tooltip label={dislikeLabel} side="bottom">
        <button
          type="button"
          className={css.action}
          aria-label={dislikeLabel}
          aria-pressed={rating === 'negative'}
          data-active={rating === 'negative' || undefined}
          disabled={pending}
          onFocus={seed}
          onPointerEnter={seed}
          onClick={() => { onRate('negative') }}
        >
          <IconDislikeOutline16 />
        </button>
      </Tooltip>
      {rating !== undefined && !noteOpen && (
        <button type="button" className={css.noteOpen} onClick={openNote}>
          {item?.note === undefined ? t('note.open') : item.note}
        </button>
      )}
      {rating !== undefined && noteOpen && (
        <span className={css.noteEditor}>
          <textarea
            className={css.noteInput}
            aria-label={t('note.aria')}
            placeholder={t('note.placeholder')}
            value={draft}
            rows={2}
            onChange={(event) => { setDraft(event.target.value) }}
          />
          <button
            type="button"
            className={css.noteSave}
            disabled={pending}
            onClick={() => { onSaveNote(rating) }}
          >
            {t('note.save')}
          </button>
          <button type="button" className={css.noteCancel} onClick={() => { setNoteOpen(false) }}>
            {t('note.cancel')}
          </button>
        </span>
      )}
      {failure === null && loadFailed && (
        <span className={css.failure} role="status">{t('error.load')}</span>
      )}
      {failure !== null && <span className={css.failure} role="status">{failure}</span>}
    </>
  )
}
