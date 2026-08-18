/** Opaque cursor identity for session-search pagination. */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Provider-owned opaque continuation token returned by session search. */
export type SessionSearchCursor = Branded<'SessionSearchCursor'>

/**
 * Brand an encoded provider cursor for the public search contract.
 * @param value - opaque encoded cursor value.
 * @returns the same runtime string with session-search cursor identity.
 */
export function SessionSearchCursor(value: string): SessionSearchCursor {
  return value as SessionSearchCursor
}
