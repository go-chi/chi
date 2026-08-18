/**
 * approvals domain zod schemas (respond is a client-response; the payload schema serves
 * the /api/respond endpoint's second parse after routing via the pending table).
 * ApprovalRequestId brand cast point: one.
 */

import { z } from 'zod'
import type { ApprovalRequestId } from '@deepseek-ai/dsh-user-approval/types'
import type { ApprovalResponsePayload } from './approvals.ts'
import type { Wire } from './rpc.schema.ts'
import { sessionIdSchema } from './sessions.schema.ts'

/** ApprovalRequestId: one brand cast after schema validation (the only cast point in this domain). */
export const approvalRequestIdSchema = z.string().min(1) as unknown as z.ZodType<ApprovalRequestId>

/** Approval answer payload (the result.value slot of a client-response). */
export const approvalResponsePayloadSchema = z.object({
  sessionId: sessionIdSchema,
  approvalId: approvalRequestIdSchema,
  outcome: z.union([z.literal('allowed-once'), z.literal('rejected')]),
}) satisfies z.ZodType<Wire<ApprovalResponsePayload>>
