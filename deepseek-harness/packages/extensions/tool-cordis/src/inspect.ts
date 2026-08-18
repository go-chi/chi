/**
 * Text renderers for `cordis_runtime_inspect`. Live facts come from the service store and
 * the plugin registry; what each service CAN DO comes from the generated
 * `api-catalog.ts`. This module owns the join of the two plus presentation: which
 * lines a section prints, how compact the default report stays, and what an exact
 * `name` adds.
 * @module @deepseek-ai/dsh-tool-cordis/inspect
 */

import type { Context, Fiber } from '@deepseek-ai/cordis'
import type { ScopeKey } from '@deepseek-ai/dsh-scope'
import type { Agent } from '@deepseek-ai/dsh-agent'
// Type-only: resolves `ctx.dynamicCordisRunner` (the registry this report reads).
import type {} from '@deepseek-ai/dsh-cordis-host-runner'
import { EVENT_API, INHERITED_CTX_API, SERVICE_API, TYPE_API } from './api-catalog.ts'
import type { EventApiEntry, InheritedApiEntry, ServiceApiEntry, ServiceApiMethod, TypeApiEntry } from './api-catalog.ts'
import { FiberState, STATE_LABELS } from './fiber-state.ts'

/** One live service joined with what the generated catalog knows about it. */
interface LiveService {
  /** The `ctx.<name>` key. */
  name: string
  /** Plugin fiber providing it. */
  owner: string
  /** Lifecycle state of that fiber; `active` while it is serving. */
  state: string
  /** First sentence of the catalog summary; empty when the catalog has no entry. */
  summary: string
  /** Whether the generated catalog carries signatures for it. */
  catalogued: boolean
  /** Public method signatures from the catalog, empty for an uncatalogued service. */
  methods: readonly string[]
}

/** The live service registrations, read from the reflect store. */
function liveImpls(ctx: Context): { name: string; fiber: Fiber }[] {
  const store = ctx.reflect.store
  return Object.getOwnPropertySymbols(store)
    .map(key => store[key])
    .filter((impl): impl is NonNullable<typeof impl> => impl !== undefined)
}

/**
 * A summary as prose. JSDoc may name a symbol with an inline `{@link Foo.bar}`
 * tag, which the generated catalog retains verbatim; a report is read, not
 * compiled, so the link syntax is spent context and the bare symbol says the same
 * thing.
 */
function plainSummary(summary: string): string {
  return summary.replace(/\{@link\s+([^}]+)\}/g, '$1')
}

/**
 * Every service this process provides, joined with the generated catalog: what is
 * RUNNING comes from the store, what each service CAN DO comes from the catalog,
 * and a live service the catalog does not cover stays in the list as reachable
 * with no signatures rather than being dropped.
 */
function liveServices(ctx: Context, api: readonly ServiceApiEntry[]): LiveService[] {
  const catalogued = new Map(api.map(entry => [entry.key, entry]))
  return liveImpls(ctx)
    .map((impl) => {
      const entry = catalogued.get(impl.name)
      return {
        name: impl.name,
        owner: impl.fiber.name,
        state: STATE_LABELS[impl.fiber.state],
        summary: entry === undefined ? '' : plainSummary(entry.summary),
        catalogued: entry !== undefined,
        methods: entry === undefined ? [] : entry.methods.map(method => method.signature),
      }
    })
    .sort((left, right) => left.name.localeCompare(right.name))
}

/** Catalogued services with no live provider: loadable in principle, absent here. */
function absentServices(ctx: Context, api: readonly ServiceApiEntry[]): string[] {
  const live = new Set(liveImpls(ctx).map(impl => impl.name))
  return api.filter(entry => !live.has(entry.key)).map(entry => entry.key).sort()
}

/**
 * Whether a fiber is `root` itself or mounted anywhere inside `root`'s subtree.
 * @param fiber - the fiber to locate.
 * @param root - the subtree root to test against.
 * @returns true when `fiber` belongs to that subtree.
 */
export function withinFiber(fiber: Fiber, root: Fiber): boolean {
  let current = fiber
  while (true) {
    if (current === root) return true
    const parent = current.parent.fiber
    if (parent === current) return false
    current = parent
  }
}

/**
 * Service names provided by one mount's fiber subtree.
 * @param ctx - the runtime whose service registrations are inspected.
 * @param fiber - the root of the mounted fiber subtree.
 * @returns the provided service names in lexical order.
 */
export function providedServices(ctx: Context, fiber: Fiber): string[] {
  return liveImpls(ctx)
    .filter(impl => withinFiber(impl.fiber, fiber))
    .map(impl => impl.name)
    .sort()
}

/**
 * Services a fiber declared in `inject` that do not exist yet — a settled fiber
 * that is not active is waiting on exactly these (legal cordis semantics: it
 * activates when the service appears).
 * @param ctx - the context to resolve service existence against.
 * @param fiber - the fiber whose `inject` declarations are checked.
 * @returns the missing service names, in declaration order.
 */
export function missingServices(ctx: Context, fiber: Fiber): string[] {
  return Object.keys(fiber.inject).filter(service => ctx.get(service) === undefined)
}

/**
 * The `services` section: every live ctx service with its owning fiber and, when
 * the generated catalog covers it, a one-line summary. The `api` section is the
 * one that carries signatures; this one answers what exists and who provides it.
 * @param ctx - the runtime to enumerate.
 * @param api - the generated service entries whose summaries annotate the live ones.
 * @returns one line per service, or a single placeholder line when none are provided.
 */
export function describeServices(ctx: Context, api: readonly ServiceApiEntry[] = SERVICE_API): string[] {
  const live = liveServices(ctx, api)
  if (live.length === 0) return ['(no services provided)']
  return live.map((service) => {
    const state = service.state === STATE_LABELS[FiberState.ACTIVE] ? '' : `, ${service.state}`
    const summary = service.summary === '' ? '' : ` — ${service.summary}`
    return `- ${service.name} (provided by ${service.owner}${state})${summary}`
  })
}

/**
 * The `plugins` section: a flat list of every fiber the registry knows, one line
 * per fiber with its lifecycle state, sorted by plugin name (a plugin mounted
 * more than once repeats — one line per instance). Temporary plugins are listed
 * like any other plugin; their ids live in the `temporary` section.
 * @param ctx - the runtime whose registry is enumerated.
 * @returns one line per loaded plugin fiber.
 */
export function describePlugins(ctx: Context): string[] {
  const fibers: Fiber[] = []
  for (const runtime of ctx.registry.values()) {
    for (const fiber of runtime.fibers) fibers.push(fiber)
  }
  return fibers
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(fiber => `- ${fiber.name} [${STATE_LABELS[fiber.state]}]`)
}

/**
 * The `tools` section: the model-facing tool names the CALLING agent can see
 * (its scoped layer shadowing/joining the restricted global tool set) — the
 * honest answer to the tool description's "what you can call".
 * @param ctx - the runtime whose tool registry is read.
 * @param scope - the calling agent (the viewing scope); omitted = global view.
 * @returns one line per visible tool.
 */
export function describeTools(ctx: Context, scope?: ScopeKey): string[] {
  return ctx.tools.schemas(scope).map(schema => `- ${schema.name}`)
}

/**
 * The `temporary` section: one line per dynamic package this session defined,
 * with its metadata, which halves exist, the host half's lifecycle state and
 * provides/waits, the invoke methods it registered, and the last browser-half
 * load report. Session-scoped like every runner verb.
 * @param ctx - the runtime the packages live in.
 * @param agent - the calling agent; without one there is no definition space to report.
 * @returns one line per package, or a single placeholder line when none exist.
 */
export function describeDynamic(ctx: Context, agent?: Agent): string[] {
  const rows = agent === undefined ? [] : ctx.dynamicCordisRunner.snapshot(agent)
  if (rows.length === 0) {
    return ['No dynamic Plugins are defined in this session. Definitions live only in this process\'s memory, so a DSH restart clears them.']
  }
  return rows.flatMap((row) => {
    const head = `- Plugin ${row.pluginId}; current: ${row.currentPackageId ?? 'none'}; next: ${row.nextPackageId ?? 'none'}`
      + (row.activeRun === undefined
        ? '; stopped'
        : `; active: ${row.activeRun.packageId} as ${row.activeRun.pluginRunId}`)
    const packages = row.packages.map((pkg) => {
      const halves = [...pkg.hasHostHalf ? ['host'] : [], ...pkg.hasClientHalf ? ['client'] : []].join('+')
      const active = row.activeRun?.packageId === pkg.packageId ? row.activeRun : undefined
      if (active === undefined) return `    - ${pkg.packageId}: ${pkg.name} (${halves}) — ${pkg.purpose}`
      const fiber = active.fiber
      const state = fiber === undefined ? 'running' : fiber.state === FiberState.ACTIVE ? 'running' : STATE_LABELS[fiber.state]
      const provides = fiber === undefined ? [] : providedServices(ctx, fiber)
      const waiting = fiber === undefined ? [] : missingServices(ctx, fiber)
      const failure = active.renderFailure
      const rendered = failure === undefined
        ? ''
        : `; CLIENT RENDER FAILED at ${failure.slot}: ${failure.message}${failure.abdicated ? ' (entry removed)' : ''}`
      return `    - ${pkg.packageId}: ${pkg.name} [${state}, ${active.pluginRunId}] (${halves}) — ${pkg.purpose}`
        + `; provides: ${provides.join(', ') || 'none'}; waiting for: ${waiting.join(', ') || 'none'}`
        + (active.handlers.length === 0 ? '' : `; host methods: ${active.handlers.join(', ')}`)
        + rendered
    })
    return [head, ...packages]
  })
}

/**
 * The transitive closure of catalogued type shapes referenced (word-bounded)
 * by the seed texts — the runtime scoping that keeps the `api` section to the
 * shapes the LIVE signatures actually mention.
 */
function typeClosure(seeds: string[], types: readonly TypeApiEntry[]): TypeApiEntry[] {
  const included = new Map<string, TypeApiEntry>()
  let frontier = seeds
  while (frontier.length > 0) {
    const next: string[] = []
    for (const entry of types) {
      if (included.has(entry.name)) continue
      const pattern = new RegExp(`\\b${entry.name}\\b`)
      if (frontier.some(text => pattern.test(text))) {
        included.set(entry.name, entry)
        next.push(entry.declaration)
      }
    }
    frontier = next
  }
  return [...included.values()].sort((left, right) => left.name.localeCompare(right.name))
}

/** Render one live catalogued service; `documented` is non-empty only for an exact-name report. */
function serviceLines(
  service: LiveService,
  documented: readonly ServiceApiMethod[],
): string[] {
  const lines = [`- ${service.name} — ${service.summary}`]
  for (const signature of service.methods) {
    const contract = documented.find(entry => entry.signature === signature)
    if (contract !== undefined) {
      lines.push(`    ${contract.description}`)
      for (const parameter of contract.parameters) lines.push(`    @param ${parameter.name} — ${parameter.description}`)
      if (contract.returns !== undefined) lines.push(`    @returns ${contract.returns}`)
      for (const failure of contract.throws ?? []) lines.push(`    @throws ${failure}`)
    }
    lines.push(`    ${signature}`)
  }
  return lines
}

/**
 * Render the generated catalog against the live runtime: live catalogued services with methods,
 * uncatalogued live services with owners, absent loadable services, referenced type shapes, and
 * inherited Context APIs.
 * @param ctx - the runtime to intersect the catalog with.
 * @param api - generated service entries, replaceable in tests.
 * @param name - exact live service key whose methods should include structured contracts; omitted for the compact catalog.
 * @param inherited - inherited `ctx` entries, replaceable in tests.
 * @param types - public type shapes, replaceable in tests.
 * @returns the section lines.
 */
export function describeApi(
  ctx: Context,
  api: readonly ServiceApiEntry[] = SERVICE_API,
  name?: string,
  inherited: readonly InheritedApiEntry[] = INHERITED_CTX_API,
  types: readonly TypeApiEntry[] = TYPE_API,
): string[] {
  const live = liveServices(ctx, api)
  const byKey = new Map(api.map(entry => [entry.key, entry]))
  const lines: string[] = []
  let selected = live.filter(service => service.catalogued)
  let documented: readonly ServiceApiMethod[] = []
  if (name !== undefined) {
    const entry = byKey.get(name)
    if (entry === undefined) throw new Error(`no catalogued service named "${name}"`)
    const service = live.find(candidate => candidate.name === name)
    if (service === undefined) throw new Error(`catalogued service "${name}" is not running`)
    selected = [service]
    documented = entry.methods
  }
  for (const service of selected) lines.push(...serviceLines(service, documented))
  if (name === undefined) {
    for (const service of live.filter(candidate => !candidate.catalogued)) {
      lines.push(`- ${service.name} (provided by ${service.owner}) — running, but this catalog has no signature for it;`
        + ` inject: ['${service.name}'] still reaches it`)
    }
    const notRunning = absentServices(ctx, api)
    if (notRunning.length > 0) lines.push(`not running (loadable services with no live provider): ${notRunning.join(', ')}`)
  }
  const shapes = typeClosure(selected.flatMap(service => [...service.methods]), types)
  if (shapes.length > 0) {
    lines.push('type shapes (referenced by the signatures above — read these before assuming a field is a string):')
    for (const shape of shapes) {
      for (const declLine of shape.declaration.split('\n')) lines.push(`    ${declLine}`)
    }
  }
  if (name === undefined) {
    lines.push('inherited ctx API:')
    for (const entry of inherited) lines.push(`- ${entry.name} — ${entry.summary}`)
  }
  return lines
}

/**
 * The `events` section: every harness event with its dispatch mode, one-line
 * summary, and exact signature, closed by the waterfall caution.
 * @param events - the event catalog (the generated one by default; injectable for tests).
 * @param name - exact event name whose signature should include its structured contract; omitted for the compact catalog.
 * @returns the section lines.
 */
export function describeEvents(events: readonly EventApiEntry[] = EVENT_API, name?: string): string[] {
  let selected = events
  if (name !== undefined) {
    const event = events.find(candidate => candidate.name === name)
    if (!event) throw new Error(`no catalogued event named "${name}"`)
    selected = [event]
  }
  const lines = selected.flatMap((event) => {
    const entry = [`- ${event.name} [${event.mode}] — ${event.summary}`]
    if (name !== undefined) {
      entry.push(`    ${event.description}`)
      for (const parameter of event.parameters) entry.push(`    @param ${parameter.name} — ${parameter.description}`)
    }
    entry.push(`    ${event.signature}`)
    return entry
  })
  lines.push('waterfall listeners receive a trailing next() and MUST call it to delegate — returning without next() short-circuits the chain.')
  return lines
}
