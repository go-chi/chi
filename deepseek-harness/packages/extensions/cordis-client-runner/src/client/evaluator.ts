/**
 * Browser-half closure evaluation: the package source runs as the body of an
 * async function whose parameters ARE the symbol surface. Shadowing parameters
 * (setTimeout/fetch/require/…) turn the ambient browser globals into teaching
 * redirects without touching the page. The host syntax-prechecked the source at
 * define time; SyntaxError handling here is the engine-divergence fallback and
 * reaches the model through the load report.
 */

import * as React from 'react'
import type { CordisDynamicPluginId } from '@deepseek-ai/dsh-api-remotes/client'

/** A mountable plugin as the closure must return it (FUNCTION or OBJECT form). */
export interface DynamicCordisEvaluatedPlugin {
  /** Optional plugin name; the runner overwrites it with the module id. */
  name?: string
  /** Services the browser half declares; the runner overwrites it from the dispatched row. */
  inject?: string[]
  /** Plugin body receiving the guard facade. */
  apply: (ctx: unknown, config?: unknown) => unknown
}

/** What the evaluator needs from the runner to build one package's closure. */
export interface DynamicCordisClosureEnv {
  /** Route `host.call` to this package's host half over the wire. */
  invoke(method: string, args: unknown): Promise<unknown>
  /** Mirror one runtime error text into the load report (console.error copies). */
  noteError(message: string): void
}

const TIMER_REDIRECT
  = 'browser timer globals are unavailable in dynamic packages. Declare inject: [\'timer\'] on the returned plugin, '
    + 'query Client Service.listService for the exact API, and close over that plugin ctx. In React, create timers '
    + 'from an event handler or React.useEffect and return callback-form disposers from the effect cleanup.'

/**
 * Where each withheld browser global sends the author instead. One home for two
 * consumers: the closure traps below throw these, and a render crash whose
 * message names one of them gets the same redirect appended — a package that
 * reached the global some other way (`window.setInterval`) crashes with the
 * engine's own bare text, and the author needs the redirect either way.
 */
export const DYNAMIC_CLIENT_REDIRECTS: Readonly<Record<string, string>> = {
  setTimeout: TIMER_REDIRECT,
  setInterval: TIMER_REDIRECT,
  clearTimeout: TIMER_REDIRECT,
  clearInterval: TIMER_REDIRECT,
  fetch:
    'network belongs to the HOST half: register a handler there with harness.handle(method, fn) and call it here via host.call(method, args).',
  require:
    'modules cannot be imported here. React arrives as the `React` closure symbol; everything else goes through ctx services or host.call.',
}

/** Callable teaching traps shadowing the ambient globals the closure must not reach. */
function closureTraps(): Record<string, () => never> {
  const traps: Record<string, () => never> = {}
  for (const [name, redirect] of Object.entries(DYNAMIC_CLIENT_REDIRECTS)) {
    traps[name] = (): never => {
      throw new Error(`${name} is not available in a dynamic client half — ${redirect}`)
    }
  }
  return traps
}

/** The `harness` seat exists only host-side; any touch teaches the split. */
function harnessTrap(): unknown {
  return new Proxy({}, {
    get(_target, prop) {
      throw new Error(
        `harness.${String(prop)} belongs to the HOST half (\`code\`): register handlers there with harness.handle(method, fn); `
        + 'the browser half calls them via host.call(method, args).',
      )
    },
  })
}

/** Per-package style-tag bookkeeping behind the `styles.insert` symbol. */
export class DynamicCordisStyles {
  private readonly tags = new Set<HTMLStyleElement>()

  /** @param pluginId - owning Plugin ID, stamped as `data-dyn` on every tag. */
  constructor(private readonly pluginId: CordisDynamicPluginId) {}

  /**
   * Inject one stylesheet, removed automatically on package unload.
   * @param css - raw CSS text.
   * @returns disposer removing this one tag early.
   */
  insert(css: string): () => void {
    if (typeof css !== 'string') throw new Error('styles.insert(css) needs a CSS string')
    const tag = document.createElement('style')
    tag.dataset.dyn = this.pluginId
    tag.textContent = css
    document.head.append(tag)
    this.tags.add(tag)
    return () => {
      this.tags.delete(tag)
      tag.remove()
    }
  }

  /** Live tag count (load-report contribution summary). */
  get count(): number {
    return this.tags.size
  }

  /** Remove every tag this package still owns (unload path). */
  dispose(): void {
    for (const tag of this.tags) tag.remove()
    this.tags.clear()
  }
}

/** Stringify one console argument for the error mirror. */
function errorText(arg: unknown): string {
  if (arg instanceof Error) return arg.message
  if (typeof arg === 'string') return arg
  if (arg === undefined) return 'undefined'
  try {
    return JSON.stringify(arg)
  } catch {
    // A circular or otherwise non-serializable console argument: the mirror
    // carries the message, and nothing else here can fail.
    return '[unserializable console argument]'
  }
}

/** Tagged write-through console; error lines additionally copy into the load report. */
function taggedConsole(pluginId: CordisDynamicPluginId, noteError: (message: string) => void): Console {
  const tag = `[cordis:${pluginId}]`
  const forward = (level: 'log' | 'info' | 'warn' | 'error' | 'debug') => (...args: unknown[]): void => {
    console[level](tag, ...args)
    if (level !== 'error') return
    noteError(args.map(errorText).join(' ').slice(0, 500))
  }
  return {
    ...console,
    log: forward('log'),
    info: forward('info'),
    warn: forward('warn'),
    error: forward('error'),
    debug: forward('debug'),
  }
}

/**
 * Narrow a closure return value to a mountable plugin (host guard mirror).
 * @param value - whatever the closure returned.
 * @returns whether the value is mountable.
 */
export function isDynamicCordisPlugin(value: unknown): value is DynamicCordisEvaluatedPlugin | ((ctx: unknown) => unknown) {
  if (typeof value === 'function') return true
  return typeof value === 'object' && value !== null
    && typeof (value as { apply?: unknown }).apply === 'function'
}

/**
 * Evaluate one package's browser half and return the (un-guarded) plugin.
 * @param pluginId - stable Plugin ID (console tag and style ownership).
 * @param clientCode - the browser half's source: an async function body returning a plugin.
 * @param env - runner wiring for `host.call` and error mirroring.
 * @param styles - the package's style bookkeeping (owned by the caller so unload can dispose it).
 * @returns the plugin the closure returned.
 * @throws teaching errors for syntax failures and non-plugin returns.
 */
export async function evaluateClientHalf(
  pluginId: CordisDynamicPluginId,
  clientCode: string,
  env: DynamicCordisClosureEnv,
  styles: DynamicCordisStyles,
): Promise<DynamicCordisEvaluatedPlugin | ((ctx: unknown) => unknown)> {
  const traps = closureTraps()
  const parameters = ['React', 'console', 'styles', 'host', 'harness', ...Object.keys(traps), 'process', 'Buffer']
  let closure: (...args: unknown[]) => Promise<unknown>
  try {
    // The wrapper mirrors the host precheck exactly, so line offsets match.
    // Evaluating a definition's browser half IS this package's product: the
    // source arrived from a host process that accepted and prechecked it.
    // oxlint-disable-next-line typescript/no-implied-eval -- see above
    const factory = new Function(...parameters, `return (async () => {\n${clientCode}\n})()`)
    closure = factory as (...args: unknown[]) => Promise<unknown>
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    // Engine-divergence fallback: the host precheck already carried the
    // line/caret teaching; browsers give only the message.
    throw new Error(
      `client half failed to parse in this browser: ${error.message}\n`
      + 'The browser half is plain JavaScript (no JSX, no TypeScript); build elements with React.createElement.',
    )
  }
  const host = {
    /**
     * Call a host-half handler of THIS package (harness.handle pairing). A call
     * with nothing to pass omits the argument: it arrives at the handler as
     * `null`, because the wire carries JSON and `undefined` is not JSON —
     * requiring `host.call('m', {})` would be a ritual, and defaulting to `{}`
     * would invent an empty argument the caller never wrote.
     */
    call: (method: string, args: unknown = null): Promise<unknown> => env.invoke(method, args),
  }
  const returned = await closure(
    React,
    taggedConsole(pluginId, (message) => { env.noteError(message) }),
    styles,
    host,
    harnessTrap(),
    ...Object.values(traps),
    undefined, // process: undefined keeps `typeof process` probes safe
    undefined, // Buffer
  )
  if (!isDynamicCordisPlugin(returned)) {
    if (returned === undefined) {
      throw new Error(
        'client half returned `undefined` — did you forget `return`?\n'
        + '  ✓ return (ctx) => { … }\n'
        + '  ✓ return { name: \'…\', inject: [\'slots\'], apply(ctx) { … } }',
      )
    }
    throw new Error('client half must `return` a plugin: a function, or an object with an `apply(ctx)` method')
  }
  return returned
}
