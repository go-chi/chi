/**
 * Client-safe type surface of the credential-reference seam: the reference
 * brand and the seam's Cordis event declaration. Types only — no runtime code,
 * and nothing here reaches a Host-only symbol, so a Client compilation face
 * reads exactly the signature the Host emits.
 *
 * @module @deepseek-ai/dsh-credentials/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Nominal reference to one credential: a POSIX-style environment-variable name. */
export type CredentialRef = Branded<'CredentialRef'>

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Committed change to a provider-managed credential source: a `set`, an
     * `unset`, or an external edit observed in storage. Ambient
     * process-environment changes are not observable and never emit. Listener
     * failures are contained and logged — a sync throw and an async rejection
     * alike — without changing the committed operation's outcome, except
     * `INVARIANT`-coded failures, which rethrow after every listener ran;
     * that rethrow reaches the emitter only from synchronous listeners, so
     * invariant checks on this event must not be async functions.
     * @param ref - the reference whose stored value changed.
     * @mode emit
     */
    'credentials/updated'(ref: CredentialRef): void
  }
}
