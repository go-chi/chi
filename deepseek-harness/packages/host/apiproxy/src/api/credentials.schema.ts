/**
 * credentials domain zod schemas (names derived from map keys:
 * credentialsDescribeRequestSchema / credentialsDescribeValueSchema / …).
 * The reference-name pattern mirrors the seam's `credentialRef` guard so an
 * invalid name fails as `bad-request` before reaching the service.
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import type { CredentialView } from './credentials.ts'

/** POSIX-portable environment-variable name (the seam's `credentialRef` pattern). */
export const credentialRefNameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/)

/** CredentialView entry of credentials.describe. */
export const credentialViewSchema = z.object({
  configured: z.boolean(),
  source: z.string().optional(),
  writable: z.boolean(),
}) satisfies z.ZodType<Wire<CredentialView>>

/** credentials.describe request payload. */
export const credentialsDescribeRequestSchema = z.object({
  refs: z.array(credentialRefNameSchema).max(64),
}) satisfies z.ZodType<Wire<RequestPayload<'credentials.describe'>>>

/** credentials.describe response value. */
export const credentialsDescribeValueSchema = z.object({
  credentials: z.record(z.string(), credentialViewSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'credentials.describe'>>>

/** credentials.set request payload: the one direction a value crosses this wire. */
export const credentialsSetRequestSchema = z.object({
  ref: credentialRefNameSchema,
  value: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'credentials.set'>>>

/** credentials.set response value. */
export const credentialsSetValueSchema = z.object({}) satisfies z.ZodType<Wire<ResponseValue<'credentials.set'>>>

/** credentials.unset request payload. */
export const credentialsUnsetRequestSchema = z.object({
  ref: credentialRefNameSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'credentials.unset'>>>

/** credentials.unset response value. */
export const credentialsUnsetValueSchema = z.object({}) satisfies z.ZodType<Wire<ResponseValue<'credentials.unset'>>>
