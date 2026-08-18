import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable identity shared by every attempt in one request-step retry chain. */
export type RetryId = Branded<'RetryId'>

/**
 * Brand an implementation-minted retry-chain identity.
 * @param id - opaque retry identity.
 * @returns the same string, branded; no validation is performed.
 */
export function RetryId(id: string): RetryId {
  return id as RetryId
}
