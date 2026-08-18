/** Host BFF entry and Loader shell for the Remote contribution assembly. */

import type { TypertForwardableEvent } from '@deepseek-ai/dsh-typert-protocol'
import { API_REMOTE_FORWARDED_EVENTS } from './remote-events.ts'

// The owner packages' client-safe `./types` exports carry the cordis `Events`
// declarations for every allowlisted event. Pulling them into this face is what
// makes the shape assertion below judge real signatures rather than an empty
// event vocabulary.
import type {} from '@deepseek-ai/dsh-commands/types'
import type {} from '@deepseek-ai/dsh-cordis-host-runner/types'
import type {} from '@deepseek-ai/dsh-credentials/types'
import type {} from '@deepseek-ai/dsh-llm/types'
import type {} from '@deepseek-ai/dsh-agent-presets/types'
import type {} from '@deepseek-ai/dsh-settings/types'

export {
  ApiRemoteSessionNotFound,
  ApiRemoteSubagentSessionOwnership,
  apiRemoteSubagentOwnershipError,
  createApiRemoteAgentResolver,
  hasApiRemoteSubagentOwner,
  inspectApiRemoteSession,
} from './agent-lookup.ts'
export type {
  ApiRemoteAgentOptions,
  ApiRemoteAgentResult,
  ApiRemoteLookupError,
} from './agent-lookup.ts'
export { API_REMOTE_FORWARDED_EVENTS } from './remote-events.ts'
export type { ApiRemoteForwardedEvent } from './types.ts'

// Shape gate over the allowlist, kept in the Host face because the Host's event
// vocabulary is the authoritative one. It pins three things at compile time:
// every entry NAMES a declared event (the predicate is keyed on `keyof
// Events`), no entry BINDS a Scope (a scoped event's `ThisParameterType` is not
// `unknown`, which is how "must not depend on AgentScope" is stated statically),
// and every entry is ONE-WAY (a waterfall or bail shape returns something other
// than void and is excluded). Widening the array to an event that fails any of
// these fails here, not on the wire.
API_REMOTE_FORWARDED_EVENTS satisfies readonly TypertForwardableEvent[]

/** Host plugin body; the selected contributions mount only in Client environments. */
export function apply(): void {}
