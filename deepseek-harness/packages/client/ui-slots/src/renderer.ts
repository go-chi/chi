/** React-free contracts between the slot host and an installed renderer. */
import type { ReactNode } from 'react'
import type { SlotEntryDef, SlotSpec, StoredEntry, Translate } from './index.ts'

/**
 * The locale face the render machinery consumes: namespace binding plus an
 * observable revision (getSnapshot/subscribe pair — the same HostObservable
 * currency as every other standard-kit source). The revision moves on every
 * active-locale or registry change; the renderer re-derives each entry's `t`
 * from (namespace, revision), so a locale switch hands out NEW function
 * references and memoized components re-render naturally. Implemented by the
 * locale plugin, installed through the runtime SlotRegistry (installLocale).
 * Install before the first render that needs the seat: outlets bind their
 * revision subscription at mount, and a face appearing later has no channel
 * to notify already-mounted outlets (the locale plugin is immediately-tier
 * infrastructure, so normal compositions install during boot).
 */
export interface LocaleFace extends HostObservable<{ revision: number }> {
  /**
   * Bind a namespace to a translate function reading the active locale at
   * call time. Identity may be stable per namespace — freshness of rendered
   * text is carried by the renderer's (ns, revision) seat derivation, not by
   * this binding.
   * @param ns - dictionary namespace.
   * @returns the namespace-bound translate function.
   */
  bind(ns: string): Translate
}

/** Minimal observable API for host-provided standard-kit data sources. */
export interface HostObservable<T> {
  getSnapshot(): T
  subscribe(fn: () => void): () => void
}

/**
 * Type-erased store instance face at the render boundary (the typed twin is
 * {@link StoreInstance}): a bare snapshot source plus the draft-stripped
 * action callbacks. No React hook crosses this boundary — the render machinery
 * binds `useStore` from the source at its own side (cached per instance);
 * typing lands at the component boundary via {@link PropsStore}.
 */
export interface StoreInstanceLike {
  getSnapshot(): unknown
  /**
   * Subscribe to state changes (uSES subscribe side).
   * @param fn - change callback.
   * @returns unsubscribe.
   */
  subscribe(fn: () => void): () => void
  readonly actions: Record<string, (...params: never[]) => void>
}

/**
 * Per-session standard props resolved per session id (identity-stable per
 * session scope; a recreated scope yields a new info). Plugins contribute
 * members through the runtime `sessions.provide` contract; the render side binds
 * every `hooks` source into a `use<Name>` selector hook (hooks never appear
 * on the host contract) and spreads `props` verbatim. The runtime itself
 * contributes the first entry (`'session'` → `useSession`).
 */
export interface SessionMaybeProvideInfo {
  /** Current session id, absent while the application is in no-session mode. */
  sessionId: string | undefined
  /**
   * Static hook roster. Each value is absent with the session; keys remain so
   * session-maybe entries always receive the same hook-shaped standard kit.
   */
  hooks: Record<string, HostObservable<unknown> | undefined>
  /** Static plain-member roster; values are undefined with the session. */
  props: Record<string, unknown>
  /**
   * Key-addressed projection value sources (the useProjection framework seat;
   * session-projection subsystem page: docs/subsystems/session-projection.md).
   * Unlike `hooks`, the key space is open — values
   * arrive from host-computed push frames — so the render side binds per
   * resolved key instead of per static roster member. Faces are always
   * defined per key (absence is an `undefined` snapshot); the whole member is
   * absent with the session.
   */
  projections?: { faceOf(key: string): HostObservable<unknown> } | undefined
}

/** Definite per-session standard props resolved for strict session slots. */
export interface SessionProvideInfo extends SessionMaybeProvideInfo {
  sessionId: string
  /** Bare observable sources, keyed by hook base name ('session' → useSession). */
  hooks: Record<string, HostObservable<unknown>>
}

/** renderSlot dispatch options at the machinery level. */
export interface RenderOpts {
  entryKey?: string
  only?: string
  fallback?: ReactNode
  /** Opaque occurrence context consumed only by function-valued injected Hooks. */
  hookContext?: unknown
}

/** Host API the runtime SlotRegistry presents to the installed renderer. */
export interface SlotRendererHost {
  /**
   * Subscribe to a key's registration changes (microtask-batched).
   * @param key - slot key.
   * @param fn - change callback.
   * @returns unsubscribe.
   */
  subscribe(key: string, fn: () => void): () => void
  /**
   * Monotonic version for uSES pairing.
   * @param key - slot key.
   * @returns current version.
   */
  getVersion(key: string): number
  /**
   * Snapshot the registered entries for a key (stable reference between mutations).
   * @param key - slot key.
   * @returns entries in registration (list: order) sequence.
   */
  entriesOf(key: string): readonly StoredEntry[]
  /**
   * Shadowing winners per cell for a key — the render read for single/keyed/
   * list dispatch: the first live (non-abdicated) entry of each cell in
   * priority order; chain keys pass through unchanged (election consumes
   * every entry). Fresh array per call — a render-body read, not a uSES
   * getSnapshot source.
   * @param key - slot key.
   * @returns the winning entry per occupied cell.
   */
  entriesOfSlot(key: string): readonly StoredEntry[]
  /**
   * Report an entry boundary crash. With `info.abdicate` (shadowing kinds)
   * the entry retires from its cell, one-shot, so the next survivor renders;
   * chain crashes report without abdicating. The registration stays on the
   * ledger either way.
   * @param key - slot key the entry rendered under.
   * @param entry - the crashed entry.
   * @param error - the crash cause.
   * @param info - `abdicate`: whether the crash retires the entry from its cell.
   */
  reportEntryError(key: string, entry: StoredEntry, error: unknown, info: { abdicate: boolean }): void
  /**
   * Declared runtime spec from the declarations ledger.
   * @param key - slot key.
   * @returns the spec, or undefined while the key is undeclared (outlets render empty).
   */
  specOf(key: string): SlotSpec<SlotEntryDef> | undefined
  /**
   * Stale-authorization check: whether the entry is still in the ledger.
   * @param entry - a previously rendered entry.
   * @returns false once the entry's registration was disposed.
   */
  isLive(entry: StoredEntry): boolean
  /**
   * Resolve (create or return cached) the store instance for an entry's
   * declared handle under a scope key; lifecycle rides the ledger axis.
   * @param entry - entry whose declaration carries the handle.
   * @param scopeKey - session id for session-scope slots, undefined for root scope.
   * @returns the instance, or undefined when the entry declares no store.
   */
  storeOf(entry: StoredEntry, scopeKey: string | undefined): StoreInstanceLike | undefined
  /** Session-side standard-kit sources. */
  sessions: {
    /** Session list source backing the useSessions standard hook. */
    list: HostObservable<unknown>
    /**
     * Atomic current-session provide projection used by SessionProvider:
     * selection changes and provider-roster changes publish through this one
     * source, so a stable current id cannot strand mounted entries on an
     * obsolete hook/prop schema. Carries the static roster with sessionId
     * undefined while no current session resolves.
     */
    provideInfo: HostObservable<SessionMaybeProvideInfo>
  }
  /** Workspace-side standard-kit sources. */
  workspaces: {
    /** Workspace list source backing the useWorkspaces standard hook. */
    list: HostObservable<unknown>
  }
  /**
   * Installed locale face backing the `t` standard seat (absent until the
   * locale plugin installs one; rendering an entry that declared `locale:`
   * without it is an assembly failure).
   */
  locale?: LocaleFace | undefined
}

/** The installation contract: runtime owns install()/renderSlot(); web-react implements rendering. */
export interface SlotRenderer {
  /**
   * Render the root slot tree over the host API (the only ctx-level entry).
   * @param host - the installing service's host API.
   * @param ownerProps - owner props from the shell's renderSlot('root', ...) call.
   * @returns the rendered tree.
   */
  renderRoot(host: SlotRendererHost, ownerProps: object): ReactNode
}

/** Thrown when a retained renderSlot binding is invoked after its declaring entry was disposed. */
export class StaleAuthorizationError extends Error {}

/**
 * Thrown when a renderSlot binding is invoked for a key outside its entry's
 * children declaration (plain-JS backstop; typed callers are narrowed
 * statically).
 */
export class SlotOwnershipError extends Error {}
