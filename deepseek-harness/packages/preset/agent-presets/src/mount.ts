/**
 * Mount one preset composition under an agent's scope context, then prove the
 * result is usable before the agent is published.
 *
 * The scope context is what makes the composition per-session: entry contexts
 * chain to the context the subtree was plugged into, so every `ctx.tools`
 * and `ctx.systemPrompt` registration inside the preset files into that
 * agent's layer and unwinds with it. Two guards make that safe. A row that
 * never reached a usable state is rejected, because a directly-plugged subtree
 * is absent from `ctx.loader.entries()` and no boot audit covers it. A row that
 * published a service into the ROOT realm is rejected, because such a service
 * is process-global rather than per-session and the second session mounting the
 * same preset collides with the first.
 * @module @deepseek-ai/dsh-agent-presets/mount
 */

import { isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import { Include } from '@deepseek-ai/cordis-plugin-include'
import type { EntryTree } from '@deepseek-ai/cordis-plugin-loader'
import { scopeOf, scopeParentOf, type ScopeKey } from '@deepseek-ai/dsh-scope'
import { PresetMountError, type AgentPreset } from './preset.ts'

/** What one mounted subtree publishes about itself for the audit to read. */
interface MountedTree {
  /** The rows the composition created. */
  readonly tree: EntryTree
  /**
   * The subtree's own fiber. Captured here rather than taken from
   * `ctx.plugin()`, which hands back a thenable `Object.create(fiber)` wrapper
   * that is never identical to the fiber appearing in a parent chain.
   */
  readonly fiber: Fiber
}

/**
 * Subtrees captured by config identity. A subtree plugged directly (rather than
 * created as a loader entry) never links itself to an `Entry`, so this is the
 * only handle to the rows it created; config objects are minted per mount, so
 * concurrent mounts cannot collide.
 */
const mounted = new WeakMap<object, MountedTree>()

/**
 * The base URL bare specifiers resolve against, per pending mount, keyed by the
 * same config object. Recorded before the subtree is plugged, because `Include`
 * rewrites its own context's `baseUrl` to the composition's directory and the
 * pre-mount value is the only handle on where the harness itself lives.
 */
const harnessBase = new WeakMap<object, string>()

/**
 * Include subclass that publishes its tree and fiber for the audit, and never
 * writes to the file it read.
 */
class PresetTree extends Include {
  constructor(ctx: Context, config: Include.Config) {
    super(ctx, config)
    mounted.set(config, { tree: this, fiber: ctx.fiber })
  }

  /**
   * Resolve a bare specifier from the harness rather than from the preset.
   *
   * `EntryTree.import()` resolves against the tree's own `baseUrl`, which
   * `Include` sets to the composition's directory. That is right for a
   * relative specifier — a preset's own files travel with it — and wrong for
   * a package name: a locally authored preset lives under the user's home,
   * where Node's upward `node_modules` walk never reaches the harness's own
   * dependencies, so every `@deepseek-ai/dsh-*` row would fail to import. The
   * mount records the host composition's base instead, which is inside the
   * installed harness, and bare names resolve from there. An absolute
   * filesystem path names neither base and becomes a file URL before Node's
   * ESM loader receives it, which is required for drive-letter paths on
   * Windows.
   * @param name - the module specifier from the row.
   * @param getOuterStack - the loader's stack composer for import diagnostics.
   * @returns the imported module, or the `cordis:` builtin.
   */
  override import(name: string, getOuterStack?: () => string[]): unknown {
    const specifier = isAbsolute(name) ? pathToFileURL(name).href : name
    const base = harnessBase.get(this.config)
    /* v8 ignore next -- every PresetTree is constructed by `mountPreset`, which records the base first */
    if (base === undefined) return super.import(specifier, getOuterStack)
    if (name.startsWith('.') || name.startsWith('cordis:')) return super.import(name, getOuterStack)
    const internal = this.ctx.loader.internal
    /* v8 ignore next -- Node always supplies the internal module loader; the branch keeps a
       hypothetical embedder from losing the row's name in a resolution error. */
    if (internal === undefined) return super.import(specifier, getOuterStack)
    return internal.import(specifier, base, {})
  }

  /**
   * A preset is an input, never a persistence target.
   *
   * The Loader writes a tree back through this method whenever it decides the
   * config changed — a plugin self-disposing is enough, and tearing an agent
   * down disposes its whole subtree. Inherited, that rewrites the preset file
   * with whatever the dying tree held, which in practice means truncating a
   * shipped composition to `[]` the first time a session ends. Persisting a
   * preset is also meaningless: nothing here is user state, and the same file
   * backs every session that names it.
   *
   * Dropping the write drops the `loader/config-update` the inherited method
   * emits with it. Nothing observes one for a preset subtree today, and a
   * future "edit your preset while it runs" flow needs a deliberate
   * persistence path rather than this method's return.
   */
  override write(): void {
  }
}

/** One preset composition currently installed under some agent. */
export interface PresetMount {
  /** The preset the subtree was composed from. */
  readonly presetId: string
  /** The mounted subtree's fiber. */
  readonly fiber: Fiber
  /** The standing scope key agents are parented to (undefined only in torn-down records). */
  readonly key: ScopeKey | undefined
}

const mounts = new Set<PresetMount>()

/**
 * Drop every record whose subtree is gone.
 *
 * Records are pruned by observation rather than through a disposal hook
 * because a subtree can be torn down by its owning agent, by a failed mount, or
 * by the whole tree unloading, and a cleared `uid` is what all three share.
 *
 * Pruning therefore has to happen on a path this module owns. Reading is one
 * such path, but not a reliable one: the only production reader is the
 * invariant companion's service listener, and `dsh-invariants` is a
 * development composition — a shipped host never loads it. Mounting is the
 * other, and it is the one every session takes, which bounds the set at one
 * generation of dead records rather than one per session ever composed. Each
 * record would otherwise retain its whole disposed subtree: the fiber holds
 * its config, and that config is the key its `EntryTree` is stored under.
 */
function pruneDisposedMounts(): void {
  for (const mount of mounts) {
    if (mount.fiber.uid === null) mounts.delete(mount)
  }
}

/**
 * Every preset composition still installed, pruning fibers disposed since the
 * last read.
 * @returns the live mounts.
 */
export function livePresetMounts(): PresetMount[] {
  pruneDisposedMounts()
  return [...mounts]
}

/**
 * Whether `fiber` is `root` itself or is mounted anywhere inside its subtree.
 *
 * Membership is object identity. `uid` looks like a cheaper key but is a
 * per-registry counter, so fibers in two different roots collide on it and a
 * subtree in one runtime would be blamed for a service published in another.
 * @param fiber - the fiber to locate.
 * @param root - the subtree root to test membership against.
 * @returns true when `fiber` belongs to `root`'s subtree.
 */
function withinFiber(fiber: Fiber, root: Fiber): boolean {
  let current = fiber
  while (true) {
    if (current === root) return true
    const parent = current.parent.fiber
    if (parent === current) return false
    current = parent
  }
}

/**
 * Service names the mounted subtree published into the root realm.
 *
 * A provider without an `isolate` realm stores its implementation under the
 * root's symbol for that name, which is exactly the comparison below; a
 * provider inside an `isolate` realm stores under a realm-private symbol and
 * is correctly absent here.
 * @param ctx - any context of the runtime whose service store is inspected.
 * @param mount - the mounted subtree's fiber.
 * @returns the leaked service names in lexical order.
 */
export function leakedServices(ctx: Context, mount: Fiber): string[] {
  const store = ctx.reflect.store
  const rootIsolate = ctx.root[Context.isolate]
  const leaked: string[] = []
  for (const key of Object.getOwnPropertySymbols(store)) {
    const impl = store[key]
    /* v8 ignore next -- cordis deletes a store slot on disposal rather than
       clearing it, so an own symbol always resolves; the guard exists only
       because the store's index signature is optional. */
    if (impl === undefined) continue
    if (!withinFiber(impl.fiber, mount)) continue
    if (rootIsolate[impl.name] === key) leaked.push(impl.name)
  }
  return leaked.sort((left, right) => left.localeCompare(right))
}

/** A live standing mount located through one agent already joined to it. */
export type JoinedPresetMount = PresetMount & {
  /** The standing key, definite because it is what the lookup matched on. */
  readonly key: ScopeKey
}

/**
 * The standing composition one agent is joined to.
 *
 * The agent's own key is parented to its preset's standing key, so the mount
 * is found by matching that parent rather than by walking up from the agent —
 * the mount is not under the agent's fiber. An agent that joined no preset —
 * a deployment composing no roster, or a child agent before its join — has no
 * parent link and resolves to undefined.
 * @param agentCtx - the agent's scope context.
 * @returns the mount the agent joined, or undefined when it joined none.
 */
export function standingMountFor(agentCtx: Context): JoinedPresetMount | undefined {
  const agentKey = scopeOf(agentCtx)
  if (agentKey === undefined) return undefined
  const standingKey = scopeParentOf(agentKey)
  if (standingKey === undefined) return undefined
  return livePresetMounts().find(
    (candidate): candidate is JoinedPresetMount => candidate.key === standingKey,
  )
}

/**
 * One agent's instance of a service its preset mounted.
 *
 * A preset publishes a service behind an `isolate` realm so two sessions
 * cannot collide, and an entry-local realm is invisible to everything outside
 * the group — including the agent's own scope context and the host. That is
 * right for the rows inside the group and wrong for one caller: a request that
 * is ABOUT a session but arrives from outside it, which is every browser RPC
 * the api-proxy serves.
 *
 * Ownership is the same relation {@link leakedServices} reads, inverted: there
 * it names implementations a subtree published into the ROOT realm, here it
 * names the one this subtree published anywhere. Fiber membership is object
 * identity for the reason stated on {@link withinFiber}.
 *
 * This is READ addressing for a caller that already holds the agent. It is not
 * a general host handle on a session's internals: a host row that `inject`s a
 * service cannot use it, because injection resolves before any session exists
 * and has no agent to key by — such a service belongs on the host plane.
 * @param ctx - any context of the runtime whose service store is inspected.
 * @param agent - the agent whose mounted composition to look inside.
 * @param name - the service name as the preset's rows resolve it.
 * @returns the agent's instance, or undefined when its preset mounts none.
 */
export function serviceForAgent<K extends string & keyof Context>(
  ctx: Context,
  agent: { ctx: Context },
  name: K,
): Context[K] | undefined {
  const mount = standingMountFor(agent.ctx)
  if (mount === undefined) return undefined
  const store = ctx.reflect.store
  for (const key of Object.getOwnPropertySymbols(store)) {
    const impl = store[key]
    /* v8 ignore next -- cordis deletes a store slot on disposal rather than clearing it */
    if (impl === undefined) continue
    if (impl.name !== name) continue
    if (withinFiber(impl.fiber, mount.fiber)) return impl.value as Context[K]
  }
  return undefined
}

/**
 * Rows that did not reach a usable state, each rendered as one diagnostic line.
 *
 * A row whose module failed to import or whose plugin threw already rejects the
 * mount through the loader; what remains observable here is a row still waiting
 * for a service the composition never supplies.
 * @param tree - the mounted subtree.
 * @returns one line per unusable row, empty when every enabled row is usable.
 */
export function inactiveRows(tree: EntryTree): string[] {
  const lines: string[] = []
  for (const entry of tree.entries()) {
    if (entry.disabled) continue
    const fiber = entry.fiber
    /* v8 ignore next 4 -- the loader rejects an entry whose module or plugin failed,
       so a settled tree never holds an enabled fiber-less entry; the branch exists
       only because `Entry.fiber` is declared optional. */
    if (fiber === undefined) {
      lines.push(`${entry.options.id} (${entry.options.name}): never started`)
      continue
    }
    const missing = Object.keys(fiber.inject).filter(name => fiber.ctx.get(name) === undefined)
    if (missing.length > 0) {
      lines.push(`${entry.options.id} (${entry.options.name}): waiting for ${missing.join(', ')}`)
    }
  }
  return lines
}

/**
 * The reportable text of a mount failure.
 *
 * The loader reports several failed rows as one `AggregateError`, whose own
 * message names none of them; without flattening, a composition that fails on
 * two rows says only "loader entries failed to apply" and the operator has
 * nothing to act on.
 * @param error - the value the mount rejected with.
 * @returns a single-line-per-cause description.
 */
function mountDetail(error: unknown): string {
  /* v8 ignore next -- every path into the mount's catch throws an Error: the loader
     wraps a row's thrown value before it propagates, and this module's own
     rejections are Errors. The fallback keeps a hostile value readable. */
  if (!(error instanceof Error)) return String(error)
  if (!(error instanceof AggregateError)) return error.message
  return [error.message, ...error.errors.map(cause => `- ${mountDetail(cause)}`)].join('\n')
}

/**
 * Mount `preset` under `agentCtx` and return only once every row is usable.
 *
 * The subtree is owned by `agentCtx`'s fiber, so it unwinds with the agent and
 * the caller receives no disposer. A rejection leaves nothing mounted.
 * @param agentCtx - the agent's scope context, from the agent factory's `setup`.
 * @param preset - the resolved preset to compose the agent from.
 * @throws when `agentCtx` carries no scope, a row is unusable, or a row
 * published a service into the root realm.
 */
export async function mountPreset(agentCtx: Context, preset: AgentPreset): Promise<void> {
  const scope = scopeOf(agentCtx)
  if (scope === undefined) {
    throw new Error(
      `agent-presets: refusing to mount preset "${preset.id}" into an unscoped context; `
      + 'its registrations would apply to every agent in the process',
    )
  }
  const config: Include.Config = { path: pathToFileURL(preset.path).href }
  // Captured before the subtree exists: the standing scope context still
  // carries the host composition's base, which is inside the installed
  // harness and is therefore where a row's package name has to resolve from.
  /* v8 ignore next -- the Loader sets `baseUrl` on the root before any scoped context derives from it */
  if (agentCtx.baseUrl !== undefined) harnessBase.set(config, agentCtx.baseUrl)
  // Before the record this mount is about to add: standing mounts are one per
  // preset and live until whole-tree teardown, so pruning here only sweeps
  // records of torn-down runtimes (tests; an HMR reload of the roster).
  pruneDisposedMounts()
  const handle = agentCtx.plugin(PresetTree, config)
  try {
    await handle.await()
    const subtree = mounted.get(config)
    /* v8 ignore next -- the subclass constructor runs before `await()` settles for every mounted tree */
    if (subtree === undefined) throw new Error('mounted subtree did not publish its entry tree')
    const { tree, fiber } = subtree
    const unusable = inactiveRows(tree)
    if (unusable.length > 0) {
      throw new Error(`${String(unusable.length)} row(s) did not activate:\n${unusable.join('\n')}`)
    }
    const leaked = leakedServices(agentCtx, fiber)
    if (leaked.length > 0) {
      throw new Error(
        `row(s) published process-global service(s) [${leaked.join(', ')}]; `
        + 'a preset service must sit behind an `isolate` realm or move to the host composition',
      )
    }
    mounts.add({ presetId: preset.id, fiber, key: scopeOf(agentCtx) })
  } catch (error) {
    try {
      await handle.dispose()
    /* v8 ignore next 5 -- teardown of a subtree nothing else references has no
       observed failure mode; the guard exists so a teardown error cannot
       replace the mount diagnostic the caller needs. */
    } catch {
      // Swallows only this subtree's teardown failure. The mount error below is
      // the actionable one, and the discarded fiber is unreachable either way.
    }
    throw new PresetMountError(preset.id, `${mountDetail(error)} (${preset.path})`, { cause: error })
  }
}
