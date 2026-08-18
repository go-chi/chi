/**
 * Client module system: the browser peer of Node's internal ESM loader, built
 * as a lazy CJS table. The vendored cordis Loader consumes this object
 * through its `internal` contract (the only call site is `EntryTree.import` →
 * `internal.import`), which keeps entry governance (fiber lifecycle, inject
 * waiting, update/refresh) entirely on the vendored side while this package
 * owns code arrival.
 *
 * Lazy CJS model: executing a plugin bundle only REGISTERS its
 * factory (`window.__ModuleLoader__.load({id, factory})`); every module body
 * side effect — including CSS injection — lives inside the factory closure
 * and runs at materialization, not at script execution. Materialization
 * (factory(require) → exports) happens on first import/require and is
 * memoized in {@link ClientModuleLoader.loadCache}; a factory that requires
 * another registered-but-unmaterialized module materializes it recursively,
 * so load order needs no external sequencing.
 *
 * Resolution branch order (import): seed word → shell instance; memoized
 * record → exports; static registry (shell-own modules, e.g. app-shell) →
 * module; registered factory → materialize; graph row → load + materialize;
 * anything else → throw (loud — the runtime mirror of the
 * build-time bundle purity gate). The synchronous `require` handed to
 * factories walks the same order minus the load branch: loading is async,
 * so only already-registered bundles can be required — and cross-plugin value
 * imports are a build error anyway.
 *
 * This file is the browser-safe contract face (zero node imports): the
 * `__DSH_BOOT__` wire types, the boot-manifest parser, and the boundaries around
 * {@link ClientModuleSystem}. The package root is the host-side service that
 * composes the wire.
 */

import type {} from '@deepseek-ai/cordis'
import type { ClientModuleSystem } from './system.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The client module system the web shell builds at boot (provided by the `./client` wrapper plugin). */
    modules: ClientModuleLoader
  }
}

/**
 * One composed client entry pushed by the host (a graph row). Wire
 * single source: the host node half (package root) produces this same shape.
 * `immediately` marks stage-one prefetch; `inject` is informational graph
 * metadata (the authoritative edges live in each package's `dsh.client`
 * declaration and reach fibers through entry creation).
 */
export interface WebBootEntry {
  /** Entry name == package name. */
  id: string
  /** Bundle endpoint, '/plugins/<id>/client.js?rev=<rev>'. */
  url: string
  /** Bundle content hash (cache-busting consistency anchor). */
  rev: string
  /** Package-name dependency edges, informational (preflight display / HMR diffing). */
  inject?: string[]
  /** Stage-one prefetch mark: load the script for factory registration during module-face boot. */
  immediately?: boolean
}

/** The composed client entry graph the host injects as `window.__DSH_BOOT__`. */
export interface WebBootGraph {
  /** Consistency anchor over the whole graph (content + bundle hashes). */
  rev: string
  /** Composed entries; order carries no semantics (activation order is fiber inject waiting). */
  entries: WebBootEntry[]
}

/** The npm-package view of one boot row: what the module table needs to fetch the bundle. */
export interface BootModuleRow {
  /** Entry name == package name (module-table key). */
  id: string
  /** Bundle endpoint, '/plugins/<id>/client.js?rev=<rev>'. */
  url: string
  /** Bundle content hash. */
  rev: string
}

/** The cordis-plugin view of one boot row: what entry composition needs (optional wire fields normalized). */
export interface BootPluginRow {
  /** Entry name == package name. */
  id: string
  /** Package-name dependency edges ([] when the wire omits them). */
  inject: string[]
  /** Stage-one prefetch tier (false when the wire omits it). */
  immediately: boolean
}

/** The parsed boot manifest: one wire, two consumer views. */
export interface BootManifest {
  /** Consistency anchor over the whole graph. */
  rev: string
  /** Rows as the module table consumes them. */
  modules: BootModuleRow[]
  /** Rows as entry composition consumes them. */
  plugins: BootPluginRow[]
}

/**
 * Parse `window.__DSH_BOOT__` into the two consumer views. Wire boundary:
 * a missing or malformed graph throws (the shell shows the loud failure —
 * a page without a valid manifest cannot boot anything).
 * @param wire - the raw `window.__DSH_BOOT__` value.
 * @returns the manifest with optional plugin-view fields normalized.
 */
export function parseBootManifest(wire: unknown): BootManifest {
  if (typeof wire !== 'object' || wire === null) {
    throw new Error('client-modules: window.__DSH_BOOT__ is missing or not an object')
  }
  const graph = wire as Record<string, unknown>
  if (typeof graph.rev !== 'string') {
    throw new Error('client-modules: boot manifest rev must be a string')
  }
  if (!Array.isArray(graph.entries)) {
    throw new Error('client-modules: boot manifest entries must be an array')
  }
  const modules: BootModuleRow[] = []
  const plugins: BootPluginRow[] = []
  for (const value of graph.entries as unknown[]) {
    if (typeof value !== 'object' || value === null) {
      throw new Error('client-modules: boot manifest entry is not an object')
    }
    const row = value as Record<string, unknown>
    const where = typeof row.id === 'string' ? `"${row.id}"` : JSON.stringify(row)
    if (typeof row.id !== 'string' || typeof row.url !== 'string' || typeof row.rev !== 'string') {
      throw new Error(`client-modules: boot manifest entry ${where} must carry string id/url/rev`)
    }
    if (row.inject !== undefined && (!Array.isArray(row.inject) || row.inject.some(i => typeof i !== 'string'))) {
      throw new Error(`client-modules: boot manifest entry ${where} inject must be a string array`)
    }
    if (row.immediately !== undefined && typeof row.immediately !== 'boolean') {
      throw new Error(`client-modules: boot manifest entry ${where} immediately must be a boolean`)
    }
    modules.push({ id: row.id, url: row.url, rev: row.rev })
    plugins.push({
      id: row.id,
      inject: row.inject === undefined ? [] : [...row.inject as string[]],
      immediately: row.immediately === true,
    })
  }
  return { rev: graph.rev, modules, plugins }
}

/** The shape a client bundle hands to `window.__ModuleLoader__.load` (registration handoff). */
export interface ClientPluginHandoff {
  /** Plugin id (package name) — the registration key; must match the graph row being executed. */
  id: string
  /**
   * Closure factory holding the whole bundle body: receives the synchronous
   * require bound to the module table and returns the bundle's exports. Runs
   * once, at materialization.
   */
  factory: (require: (spec: string) => unknown) => Record<string, unknown>
}

/** Window API of the web boot protocol: the host-injected graph, registration sink, and kernel handoff slot. */
export interface DshWindow {
  /** Host-composed entry graph, injected before the shell bundle runs; wire-boundary raw until {@link parseBootManifest}. */
  __DSH_BOOT__?: unknown
  /** Bundle registration sink; installed once per page by the {@link ClientModuleSystem} constructor. */
  __ModuleLoader__?: { load(handoff: ClientPluginHandoff): void }
  /**
   * Kernel handoff slot: the shell kernel stores the instance here right
   * after construction (before cordis exists) so the `./client` wrapper
   * plugin can provide it as `ctx.modules`. Missing slot at wrapper apply
   * time = kernel sequencing bug, thrown loud.
   */
  __DSH_MODULES__?: ClientModuleSystem
}

/** Per-module bookkeeping in {@link ClientModuleLoader.loadCache} (module-graph boundary, flat today). */
export interface ClientModuleRecord {
  /** Module id (entry name / package name). */
  id: string
  /** Materialized exports (`module.exports` from a factory, or a statically registered shell module). */
  exports: unknown
  /** Owned `<style data-plugin>` tag ids (`data-plugin-css` values) injected during materialization. */
  styles: string[]
  /** Observed `require()` edges (module-graph boundary; only table words can appear today). */
  edges: Set<string>
}

/**
 * The internal-contract subset the vendored Loader and the client HMR plugin
 * consume. Mounted on `ctx.loader.internal` by the shell boot and provided
 * as `ctx.modules`.
 */
export interface ClientModuleLoader {
  /** Discriminant against Node's internal loader shapes ('v1'/'v2'). */
  version: 'client'
  /** Materialized-module registry: id → record. The governance-side read API for entry exports. */
  loadCache: Map<string, ClientModuleRecord>
  /**
   * Internal contract consumed by the vendored Loader's `tree.import`. Resolves
   * `specifier` through the branch order documented on the module, fetching
   * and executing a bundle when needed.
   * @param specifier - module specifier (entry name or table word).
   * @param parentURL - importer URL (unused — the client module graph is flat).
   * @param attrs - Import attributes (unused; interface parity with Node's loader contract).
   * @returns the module's exports.
   */
  import(specifier: string, parentURL: string, attrs: Record<string, unknown>): Promise<unknown>
  /**
   * Register a shell-own module (app-shell — code that ships inside the shell
   * bundle and never arrives as a plugin bundle).
   * @param id - entry name (shell-owned pseudo id).
   * @param module - the statically imported module namespace.
   */
  registerStatic(id: string, module: unknown): void
  /**
   * Stage-one arrival: load the entry's script to register its factory (no
   * materialization — module side effects wait for import).
   * No-op for static-registered ids and ids whose factory is already
   * registered; concurrent calls share one in-flight task. To force a fresh
   * load (HMR), {@link invalidate} first.
   * @param id - graph entry name.
   */
  prefetch(id: string): Promise<void>
  /**
   * Full reset of one module: drop its registered factory and materialized
   * record so the next prefetch/import reloads it (the HMR invalidation hook).
   * @param id - entry name to invalidate.
   */
  invalidate(id: string): void
}

/** Options for {@link ClientModuleSystem} (assembled by the web shell kernel at boot). */
export interface ClientModuleSystemOptions {
  /** Boot rows in the module-table view (from {@link parseBootManifest}). */
  modules: BootModuleRow[]
  /** Module-table seed: platform-singleton specifier → shell instance. */
  staticModules: Record<string, unknown>
  /** Bundle-load hook. Defaults to a same-origin classic `<script src>` element. */
  loadBundle?: (url: string) => Promise<void>
}
