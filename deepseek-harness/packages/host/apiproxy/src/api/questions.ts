/**
 * questions domain contract. The question requested frame is a
 * server-request whose rpcId is the question's stable logical id (minted when the host accepts
 * ask(); core user-questions has no request-level id); the answer is a client-response
 * echoing that rpcId, with no resource id in the payload (rpcId suffices).
 */

import type { AskUserQuestionAnswer } from '@deepseek-ai/dsh-user-questions/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/**
 * Question answer payload (the result.value slot of a client-response):
 * answers one ask() as a whole batch (core: one ask, many questions, one
 * answer — never split per question).
 */
export interface QuestionResponsePayload {
  sessionId: SessionId
  answer: AskUserQuestionAnswer
}
