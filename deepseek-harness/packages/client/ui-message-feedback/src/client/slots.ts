/**
 * The feedback entry's injected face. The target
 * 'conversation.chat.assistant-actions' slot is declared and typed by
 * ui-conversation; this package only contributes the entry, so no SlotMap
 * merge lives here. Live per-message state arrives through the `feedback`
 * hook (the framework standard kit binds it into `useFeedback`); inject
 * carries the two mutation verbs plus the lazy loader.
 * @module @deepseek-ai/dsh-client-ui-message-feedback/client/slots
 */

import type {
  HostObservable, InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { MessageId } from '@deepseek-ai/dsh-client-connection/client'
import type { MessageFeedbackRating } from '@deepseek-ai/dsh-message-feedback/types'
// Type-only: pulls this package's LocaleNamespaceMap merge (the 'feedback' seat).
import type {} from './locales.ts'
import type { MessageFeedbackActionResult, MessageFeedbackView } from './controller.ts'

/** Injected business face of one assistant-message feedback entry. */
export interface MessageFeedbackInjected {
  hooks: {
    /** The owning Session's feedback view, shared by every message control. */
    feedback: HostObservable<MessageFeedbackView>
  }
  /** Load the Session's feedback once, on first interaction. */
  ensure: () => Promise<MessageFeedbackActionResult>
  /**
   * Create or replace this Session's feedback for one message.
   * @param messageId - target assistant message.
   * @param rating - desired judgment.
   * @param note - optional explanation.
   */
  rate: (
    messageId: MessageId,
    rating: MessageFeedbackRating,
    note?: string,
  ) => Promise<MessageFeedbackActionResult>
  /**
   * Apply the requested judgment, retracting instead when the committed rating
   * already matches. The controller decides from the committed item, so a click
   * before the first list read still toggles the stored value.
   * @param messageId - target assistant message.
   * @param rating - the judgment the human asked for.
   */
  toggle: (messageId: MessageId, rating: MessageFeedbackRating) => Promise<MessageFeedbackActionResult>
  /**
   * Drop the note while keeping the rating.
   * @param messageId - target assistant message.
   */
  clearNote: (messageId: MessageId) => Promise<MessageFeedbackActionResult>
  /**
   * Remove this Session's feedback for one message.
   * @param messageId - target assistant message.
   */
  clear: (messageId: MessageId) => Promise<MessageFeedbackActionResult>
}

/** Full props of one assistant-message feedback entry. */
export type MessageFeedbackActionProps =
  PropsRuntime<'conversation.chat.assistant-actions'>
  & InjectFace<MessageFeedbackInjected>
  & PropsLocale<'feedback'>
