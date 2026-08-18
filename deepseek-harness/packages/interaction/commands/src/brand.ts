/**
 * dsh-commands' owned branded id: command lifecycle pairing across the
 * session log, the wire admission response, and client-side flow pairing.
 *
 * The `Branded<B>` primitive lives in `@deepseek-ai/dsh-brand`; this module
 * is a pure type/constructor outlet (no cordis imports, no module
 * augmentation) so wire and client programs can name the brand without
 * loading the host plugin's Context merges — the `dsh-llm/brand` shape.
 *
 * @module @deepseek-ai/dsh-commands/brand
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/**
 * Pairs one command execution's `command/run`/`command/done` lifecycle
 * records with each other and with the `command.execute` admission response.
 * Minted by the executor, monotonic per service instance.
 */
export type CommandId = Branded<'CommandId'>

/**
 * Brand a string as a {@link CommandId}.
 * @param id - the executor-minted pairing id.
 * @returns the same string, branded; no validation is performed.
 */
export function CommandId(id: string): CommandId {
  return id as CommandId
}
