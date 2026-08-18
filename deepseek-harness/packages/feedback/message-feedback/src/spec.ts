/**
 * Durable storage-domain declaration for lifecycle-bound message feedback.
 * @module @deepseek-ai/dsh-message-feedback/src/spec
 */

import { z } from 'zod'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { MessageFeedbackItem, MessageFeedbackRating, MessageFeedbackVersion } from './types.ts'

const nonNegativeSafeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

/** Runtime schema for the closed rating vocabulary. */
export const messageFeedbackRatingSchema = z.union([
  z.literal('positive'),
  z.literal('negative'),
]) satisfies z.ZodType<MessageFeedbackRating>

/** Runtime schema for one opaque item version stored on disk. */
export const messageFeedbackVersionSchema = z.uuid()
  .transform(value => value as MessageFeedbackVersion)

/** Runtime schema for one current feedback item. */
// Zod infers transformed branded fields structurally, so it cannot name the
// public interface even though every branded output is created below.
export const messageFeedbackItemSchema = z.object({
  messageId: z.string().min(1).transform(value => value as MessageId),
  rating: messageFeedbackRatingSchema,
  note: z.string().refine(note => note.trim().length > 0, {
    message: 'message feedback note must contain a non-whitespace character',
  }).optional(),
  version: messageFeedbackVersionSchema,
  createdAt: nonNegativeSafeInteger,
  updatedAt: nonNegativeSafeInteger,
}).refine(item => item.updatedAt >= item.createdAt, {
  path: ['updatedAt'],
  message: 'message feedback updatedAt must not precede createdAt',
}) as unknown as z.ZodType<MessageFeedbackItem>

/** Persisted Session fields that fence a sidecar row to one log lifecycle. */
export const messageFeedbackSessionIdentitySchema = z.object({
  createdAt: nonNegativeSafeInteger,
  cwd: z.string().optional(),
})

/** Persisted lifecycle identity inferred from its durable schema. */
export type MessageFeedbackSessionIdentity = z.infer<typeof messageFeedbackSessionIdentitySchema>

/**
 * One whole-Session sidecar. Duplicate message ids would make item lookup
 * ambiguous; duplicate versions would break their independent identity.
 */
export const messageFeedbackRowSchema = z.object({
  session: messageFeedbackSessionIdentitySchema,
  items: z.array(messageFeedbackItemSchema),
}).superRefine((row, ctx) => {
  const messageIds = new Set<string>()
  const versions = new Set<string>()
  row.items.forEach((item, index) => {
    if (messageIds.has(item.messageId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['items', index, 'messageId'],
        message: `duplicate message feedback id '${item.messageId}'`,
      })
    }
    messageIds.add(item.messageId)
    if (versions.has(item.version)) {
      ctx.addIssue({
        code: 'custom',
        path: ['items', index, 'version'],
        message: `duplicate message feedback version '${item.version}'`,
      })
    }
    versions.add(item.version)
  })
})

/** Durable sidecar row inferred from {@link messageFeedbackRowSchema}. */
export type MessageFeedbackRow = z.infer<typeof messageFeedbackRowSchema>

/** One lifecycle-bound sidecar record per Session id. */
export const messageFeedbackDomainSpec = defineDomain({
  name: 'message_feedback',
  version: 0,
  tables: {
    sessions: domainTable<SessionId, MessageFeedbackRow>(messageFeedbackRowSchema),
  },
})
