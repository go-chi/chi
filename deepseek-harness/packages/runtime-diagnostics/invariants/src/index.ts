/**
 * Configurable registry for package-owned runtime invariant contributions.
 * Every workspace package registers checks from a `./invariant` companion;
 * ordinary package entrypoints stay independent of diagnostics.
 *
 * @module @deepseek-ai/dsh-invariants
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { Inject } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'

/** Runtime invariant selection configured on the service plugin. */
export interface Config {
  /** Global switch; defaults to `true`. */
  readonly enabled?: boolean
  /** Case-sensitive JavaScript regex sources that admit package names; empty admits all. */
  readonly package_allowlist?: string[]
  /** Case-sensitive JavaScript regex sources that exclude package names after allowlist matching. */
  readonly package_blocklist?: string[]
}

/**
 * Throw a package-attributed invariant failure.
 * @param message - violated package contract without the standard prefix.
 * @returns never because reporting a violation throws.
 */
export type InvariantFailure = (message: string) => never

/** Install one package's checks into the registration's child context. */
export interface InvariantInstaller {
  /**
   * Install the package contribution.
   * @param ctx - child context owned by this invariant registration.
   * @param fail - reporter bound to the registering package name.
   * @returns nothing, or a promise settling after asynchronous checks finish.
   */
  (ctx: Context, fail: InvariantFailure): void | Promise<void>
  /** Services the child installer fiber may access. */
  readonly inject?: Inject
}

/** Internal effect shape used to join child startup before a companion loads. */
interface PendingInvariantRegistration extends PromiseLike<() => void> {
  (): void | Promise<void>
}

/** Thrown when a package-owned runtime invariant is violated. */
export class InvariantError extends Error {
  /** Stable machine-readable invariant failure code. */
  readonly code = 'INVARIANT' as const
  /** Full npm package name that owns the violated invariant. */
  readonly packageName: string

  /**
   * Construct a package-attributed invariant failure.
   * @param packageName - full npm package name that registered the check.
   * @param message - violated contract, without the standard error prefix.
   */
  constructor(packageName: string, message: string) {
    super(`invariant violated by "${packageName}": ${message}`)
    this.name = 'InvariantError'
    this.packageName = packageName
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    invariants: InvariantRegistry
  }
}

/** Compile and validate one package-filter list. */
function compilePatterns(field: 'package_allowlist' | 'package_blocklist', values: readonly string[]): RegExp[] {
  const seen = new Set<string>()
  return values.map((value) => {
    if (value.length === 0 || value.trim() !== value) {
      throw new Error(`invariants: ${field} entries must be non-blank and have no surrounding whitespace`)
    }
    if (seen.has(value)) {
      throw new Error(`invariants: ${field} contains duplicate regex ${JSON.stringify(value)}`)
    }
    seen.add(value)
    try {
      return new RegExp(value)
    } catch (cause) {
      throw new Error(`invariants: ${field} contains invalid regex ${JSON.stringify(value)}`, { cause })
    }
  })
}

/** Package-owned invariant registry with global and regex-based selection. */
export class InvariantRegistry extends Service {
  static Config: Schema<Config> = z.object({
    enabled: z.boolean().default(true),
    package_allowlist: z.array(z.string()).default([]),
    package_blocklist: z.array(z.string()).default([]),
  })

  private readonly enabled: boolean
  private readonly ownerCtx: Context
  private readonly packageAllowlist: readonly RegExp[]
  private readonly packageBlocklist: readonly RegExp[]
  private readonly registrations = new Set<string>()

  /**
   * Create and install the invariant registry.
   * @param ctx - Cordis context that owns the service.
   * @param config - global enablement and package-name regex filters.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'invariants')
    this.ownerCtx = ctx
    this.enabled = config.enabled ?? true
    this.packageAllowlist = compilePatterns('package_allowlist', config.package_allowlist ?? [])
    this.packageBlocklist = compilePatterns('package_blocklist', config.package_blocklist ?? [])
  }

  /** Return whether one full package name passes the configured filters. */
  private selected(packageName: string): boolean {
    if (!this.enabled) return false
    if (this.packageAllowlist.length > 0
      && !this.packageAllowlist.some(pattern => pattern.test(packageName))) return false
    return !this.packageBlocklist.some(pattern => pattern.test(packageName))
  }

  /**
   * Register one package's invariant installer. The package name is reserved
   * even when filtering disables its checks. Enabled installers run in a child
   * fiber; failure disposes that fiber and releases the reservation.
   * @param packageName - full npm package name that owns the contribution.
   * @param installer - listener or startup-check installer for the child context.
   * @returns an effect-scoped disposer for the registration.
   */
  register(packageName: string, installer: InvariantInstaller): () => void {
    if (packageName.length === 0 || packageName.trim() !== packageName || /\s/.test(packageName)) {
      throw new Error('invariants: packageName must be non-blank and contain no whitespace')
    }
    if (this.registrations.has(packageName)) {
      throw new Error(`invariants: package "${packageName}" is already registered`)
    }

    // Service method tracing binds `this.ctx` to the caller. This explicit
    // origin keeps registrations and their child fibers owned by the service;
    // companion disposal is covered independently by the returned disposer.
    const ctx = this.ownerCtx
    const registrations = this.registrations
    registrations.add(packageName)

    let registration: PendingInvariantRegistration
    try {
      registration = ctx.effect(async () => {
        if (!this.selected(packageName)) {
          return () => {
            registrations.delete(packageName)
          }
        }

        const installInvariant = (childCtx: Context) => (
          installer(childCtx, (message): never => {
            throw new InvariantError(packageName, message)
          })
        )
        try {
          const child = ctx.plugin(installer.inject === undefined
            ? installInvariant
            : Object.assign(installInvariant, { inject: installer.inject }))

          try {
            await child
          } catch (error) {
            await child.dispose()
            throw error
          }

          return async () => {
            try {
              await child.dispose()
            } finally {
              registrations.delete(packageName)
            }
          }
        } catch (error) {
          registrations.delete(packageName)
          throw error
        }
      }, `invariants.register(${JSON.stringify(packageName)})`)
    } catch (error) {
      registrations.delete(packageName)
      throw error
    }
    // Cordis attaches setup thenability and async teardown to this callable;
    // the service contract intentionally exposes only the conventional disposer.
    // oxlint-disable-next-line typescript/no-misused-promises -- the extra runtime shape stays private.
    return registration
  }
}

export default InvariantRegistry
