/**
 * Client-namespace projection of the goal domain: a pure re-export of the
 * package's types outlet. Client code imports ONLY the client namespace
 * (repo discipline), so `./client` projects the same single-source content
 * `./types` serves to host consumers — zero duplication.
 *
 * @module @deepseek-ai/dsh-goal/client
 */

export type * from './types.ts'
