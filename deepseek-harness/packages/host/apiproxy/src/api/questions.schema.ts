/**
 * questions domain zod schemas (respond is a client-response; the payload schema serves
 * the /api/respond endpoint's second parse after routing via the pending table). The question
 * identifier is the echoed rpcId; the payload carries no resource id.
 */

import { z } from 'zod'
import type { AskUserQuestionAnswer } from '@deepseek-ai/dsh-user-questions/types'
import type { QuestionResponsePayload } from './questions.ts'
import type { Wire } from './rpc.schema.ts'
import { sessionIdSchema } from './sessions.schema.ts'

/** AskUserQuestionAnswer validated strictly against core dsh-user-questions. */
export const askUserQuestionAnswerSchema = z.object({
  answers: z.array(z.object({
    id: z.string(),
    selected: z.array(z.string()),
    custom: z.string().optional(),
  })),
}) satisfies z.ZodType<Wire<AskUserQuestionAnswer>>

/** Question answer payload (the result.value slot of a client-response). */
export const questionResponsePayloadSchema = z.object({
  sessionId: sessionIdSchema,
  answer: askUserQuestionAnswerSchema,
}) satisfies z.ZodType<Wire<QuestionResponsePayload>>
