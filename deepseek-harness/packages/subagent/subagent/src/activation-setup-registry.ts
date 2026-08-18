/**
 * Internal registry of deployment capabilities composed into every continuable
 * child's unpublished creation context.
 *
 * A contribution grants a child-scoped capability without teaching the
 * continuation manager which capabilities exist. The manager owns residency;
 * this registry owns the join between plugin lifetime, unpublished setup, and
 * Activation disposal, so no installation outlives either owner and no removed
 * contribution can be installed after revocation reports completion.
 *
 * @module @deepseek-ai/dsh-subagent/activation-setup-registry
 */

import type { Context } from '@deepseek-ai/cordis'
import type { AgentSetupCommit } from '@deepseek-ai/dsh-agent'
import { errorChain } from '@deepseek-ai/dsh-llm'
import { SubagentError } from './error.ts'

/**
 * One deployment capability installed into a continuable child's unpublished
 * creation context. It composes synchronously before publication and returns
 * the disposer for exactly that installation.
 * @param childCtx - the child's unpublished scoped context.
 * @returns the disposer revoking this installation.
 */
export type ContinuableSetupContribution = (childCtx: Context) => () => void

/** One contribution's live registration. */
interface Registration {
  readonly contribution: ContinuableSetupContribution
  removed: boolean
  readonly installations: Set<Installation>
}

/** One contribution installed into one child context. */
interface Installation {
  readonly registration: Registration
  readonly childCtx: Context
  readonly dispose: () => void
  released: boolean
  /** Present until the child reaches residency. */
  transaction: TransactionState | undefined
}

/** One child's provisioning batch. */
interface TransactionState {
  readonly installations: Installation[]
  invalidated: boolean
}

/** Re-read mutable removal state after a contribution may have revoked itself. */
function isRemoved(registration: Registration): boolean {
  return registration.removed
}

/**
 * Owns continuable-child setup registrations, installations, rollback, child
 * cleanup, and immediate live revocation.
 */
export class SubagentActivationSetupRegistry {
  /** Live contributions in installation order. */
  private readonly registrations = new Set<Registration>()
  /** Child context to its live installations. */
  private readonly byChild = new Map<Context, Set<Installation>>()

  /**
   * Register one contribution.
   * @param contribution - synchronous child-scope installer.
   * @returns an idempotent registration undo.
   * @throws after attempting every installation when any disposer fails.
   */
  register(contribution: ContinuableSetupContribution): () => void {
    const registration: Registration = { contribution, removed: false, installations: new Set() }
    this.registrations.add(registration)
    return () => {
      if (registration.removed) return
      // Close before disposal so a snapshotted apply() cannot install after
      // revocation reports completion.
      registration.removed = true
      this.registrations.delete(registration)
      this.releaseAll([...registration.installations], 'contribution removal')
    }
  }

  /**
   * Install every live contribution into one unpublished child context.
   * @param childCtx - the child's unpublished scoped context.
   * @returns the provisioning commit consumed at Agent publication.
   */
  apply(childCtx: Context): AgentSetupCommit {
    const state: TransactionState = { installations: [], invalidated: false }
    try {
      for (const registration of [...this.registrations]) {
        /* v8 ignore next -- only a synchronous re-entrant revocation of an
         * already-snapshotted registration reaches this guard. */
        if (registration.removed) continue
        const installation: Installation = {
          registration,
          childCtx,
          dispose: registration.contribution(childCtx),
          released: false,
          transaction: state,
        }
        registration.installations.add(installation)
        state.installations.push(installation)
        let indexed = this.byChild.get(childCtx)
        if (indexed === undefined) {
          indexed = new Set()
          this.byChild.set(childCtx, indexed)
        }
        indexed.add(installation)
        // An installer may revoke itself before its installation record exists.
        // Dispose that escaped record and invalidate the provisioning batch.
        if (isRemoved(registration)) this.release(installation)
      }
    } catch (error: unknown) {
      // Keep the installer failure authoritative, but attempt every rollback.
      try {
        this.releaseAll([...state.installations], 'setup rollback')
      } catch (releaseFailure: unknown) {
        /* v8 ignore next -- requires independent installer and rollback faults. */
        void releaseFailure
      }
      throw error
    }
    childCtx.effect(() => () => { this.releaseChild(childCtx) }, 'subagents.activationSetup()')
    return {
      commit: () => {
        if (state.invalidated) {
          throw new SubagentError(
            'a continuable-subagent setup contribution was revoked while this child was being built; '
            + 'the child was not established',
            'ACTIVATION_SETUP_REVOKED',
          )
        }
        for (const installation of state.installations) installation.transaction = undefined
      },
    }
  }

  /** Release every remaining installation owned by one disposed child scope. */
  private releaseChild(childCtx: Context): void {
    const indexed = this.byChild.get(childCtx) ?? []
    this.releaseAll([...indexed], 'child scope disposal')
  }

  /**
   * Release a batch completely before reporting disposer failures.
   * @param installations - records to release.
   * @param during - operation name for diagnostics.
   */
  private releaseAll(installations: readonly Installation[], during: string): void {
    const failures: unknown[] = []
    for (const installation of installations) {
      try {
        this.release(installation)
      } catch (error: unknown) {
        failures.push(error)
      }
    }
    if (failures.length === 0) return
    throw new SubagentError(
      `continuable-subagent setup ${during} failed to release ${failures.length} installation(s): `
      + failures.map(failure => errorChain(failure)).join('; '),
      'ACTIVATION_SETUP_RELEASE_FAILED',
    )
  }

  /** Drop one installation from both indices and dispose it exactly once. */
  private release(installation: Installation): void {
    if (installation.released) return
    installation.released = true
    installation.registration.installations.delete(installation)
    const indexed = this.byChild.get(installation.childCtx)
    /* v8 ignore next 4 -- every live installation is indexed until this method removes it. */
    if (indexed !== undefined) {
      indexed.delete(installation)
      if (indexed.size === 0) this.byChild.delete(installation.childCtx)
    }
    if (installation.transaction !== undefined) installation.transaction.invalidated = true
    installation.dispose()
  }
}

export default SubagentActivationSetupRegistry
