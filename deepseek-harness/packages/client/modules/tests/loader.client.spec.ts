// @vitest-environment jsdom
/**
 * ClientModuleSystem behavior: lazy CJS arrival (bundle execution only
 * registers the factory), materialization on first import/require with
 * memoization and recursive self-sequencing, the resolution branch order,
 * shared in-flight arrival, invalidate-refetch (HMR), style claiming, the
 * default transport hook, and the loud failure modes (duplicate
 * registration, cycles, table misses, double boot).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ClientModuleSystem,
  type BootModuleRow, type ClientModuleLoader, type ClientPluginHandoff, type DshWindow,
} from '../src/client/index.ts'

const win = globalThis as DshWindow

type Factory = ClientPluginHandoff['factory']

afterEach(() => {
  vi.unstubAllGlobals()
  delete win.__ModuleLoader__
  for (const el of document.querySelectorAll('style, script')) el.remove()
})

const row = (id: string): BootModuleRow => ({ id, url: `/plugins/${id}/client.js?rev=0`, rev: '0' })

interface Bench {
  loader: ClientModuleLoader
  fetched: string[]
  gates: Map<string, () => void>
}

/**
 * Loader over scripted bundles: load records the row URL, optionally waits on
 * a release callback, then registers the scripted factory through the window
 * sink (`null` scripts a bundle that never calls load).
 */
function bench(
  entries: BootModuleRow[],
  bundles: Record<string, Factory | null> = {},
  opts: { seed?: Record<string, unknown>; gated?: string[] } = {},
): Bench {
  const fetched: string[] = []
  const gates = new Map<string, () => void>()
  const loader = new ClientModuleSystem({
    modules: entries,
    staticModules: opts.seed ?? {},
    loadBundle: async (url) => {
      fetched.push(url)
      if (opts.gated?.includes(url) === true) {
        await new Promise<void>((resolve) => { gates.set(url, resolve) })
      }
      const id = /\/plugins\/(.+)\/client\.js/.exec(url)?.[1]
      const factory = id === undefined ? undefined : bundles[id]
      if (factory == null || id === undefined) return
      win.__ModuleLoader__?.load({ id, factory })
    },
  })
  return { loader, fetched, gates }
}

describe('lazy CJS arrival', () => {
  it('prefetch loads and registers but does not run the factory', async () => {
    const ran: string[] = []
    const b = bench([row('a')], { a: () => { ran.push('a'); return {} } })
    await b.loader.prefetch('a')
    expect(b.fetched).toEqual(['/plugins/a/client.js?rev=0'])
    expect(ran).toEqual([])
    expect(b.loader.loadCache.size).toBe(0)
  })

  it('import materializes once and memoizes the exports', async () => {
    const ran: string[] = []
    const b = bench([row('a')], { a: () => { ran.push('a'); return { marker: 'a' } } })
    const first = await b.loader.import('a', '', {})
    const second = await b.loader.import('a', '', {})
    expect(first).toBe(second)
    expect((first as { marker: string }).marker).toBe('a')
    expect(ran).toEqual(['a'])
    expect(b.loader.loadCache.get('a')?.id).toBe('a')
  })

  it('import without prefetch loads, registers, and materializes in one call', async () => {
    const b = bench([row('a')], { a: () => ({ marker: 'direct' }) })
    const exports = await b.loader.import('a', '', {})
    expect((exports as { marker: string }).marker).toBe('direct')
    expect(b.fetched).toHaveLength(1)
  })

  it('concurrent callers share one in-flight arrival and materialize once', async () => {
    const ran: string[] = []
    const url = '/plugins/a/client.js?rev=0'
    const b = bench([row('a')], { a: () => { ran.push('a'); return { marker: 'a' } } }, { gated: [url] })
    const first = b.loader.import('a', '', {})
    const second = b.loader.import('a', '', {})
    const third = b.loader.prefetch('a')
    b.gates.get(url)?.()
    const [s1, s2] = await Promise.all([first, second, third])
    expect(s1).toBe(s2)
    expect(b.fetched).toEqual([url])
    expect(ran).toEqual(['a'])
  })

  it('prefetch after registration is a no-op without invalidate', async () => {
    const b = bench([row('a')], { a: () => ({}) })
    await b.loader.prefetch('a')
    await b.loader.prefetch('a')
    expect(b.fetched).toHaveLength(1)
  })
})

describe('require resolution', () => {
  it('a factory requiring a registered-but-unmaterialized module materializes it recursively', async () => {
    const order: string[] = []
    const b = bench([row('a'), row('b')], {
      a: (req) => {
        order.push('a')
        const dep = req('b/client') as { helper: string }
        return { got: dep.helper }
      },
      b: () => { order.push('b'); return { helper: 'from-b' } },
    })
    await b.loader.prefetch('a')
    await b.loader.prefetch('b')
    const exports = await b.loader.import('a', '', {})
    expect((exports as { got: string }).got).toBe('from-b')
    expect(order).toEqual(['a', 'b'])
    expect(b.loader.loadCache.get('a')?.edges.has('b/client')).toBe(true)
    expect(b.loader.loadCache.has('b')).toBe(true)
  })

  it('require prefers the platform seed word over the module table', async () => {
    const react = { marker: 'react' }
    const b = bench([row('a')], {
      a: req => ({ dep: req('react') }),
    }, { seed: { react } })
    const exports = await b.loader.import('a', '', {})
    expect((exports as { dep: unknown }).dep).toBe(react)
    expect(await b.loader.import('react', '', {})).toBe(react)
    expect(b.loader.loadCache.has('react')).toBe(false)
  })

  it('require answers an already-materialized module from the cache', async () => {
    let built = 0
    const b = bench([row('a'), row('c')], {
      a: req => ({ dep: req('c') }),
      c: () => { built += 1; return { marker: 'c' } },
    })
    const c = await b.loader.import('c', '', {})
    const a = await b.loader.import('a', '', {})
    expect((a as { dep: unknown }).dep).toBe(c)
    expect(built).toBe(1)
  })

  it('a require that misses the module table is loud', async () => {
    const b = bench([row('a')], { a: req => ({ dep: req('ghost') }) })
    await expect(b.loader.import('a', '', {})).rejects.toThrow('require("ghost") missed the module table')
  })

  it('a require cycle is fatal', async () => {
    const b = bench([row('a'), row('b')], {
      a: req => ({ dep: req('b') }),
      b: req => ({ dep: req('a') }),
    })
    await b.loader.prefetch('b')
    await expect(b.loader.import('a', '', {})).rejects.toThrow('require cycle through "a"')
  })
})

describe('static registry', () => {
  it('serves shell-own modules to import and require without any fetch', async () => {
    const shell = { marker: 'app-shell' }
    const b = bench([row('a')], {
      a: req => ({ dep: req('app-shell') }),
    })
    b.loader.registerStatic('app-shell', shell)
    await b.loader.prefetch('app-shell')
    expect(await b.loader.import('app-shell', '', {})).toBe(shell)
    expect(b.loader.loadCache.get('app-shell')?.styles).toEqual([])
    expect((await b.loader.import('a', '', {}) as { dep: unknown }).dep).toBe(shell)
    expect(b.fetched).toEqual(['/plugins/a/client.js?rev=0'])
  })

  it('duplicate static registration is loud', () => {
    const b = bench([])
    b.loader.registerStatic('app-shell', {})
    expect(() => { b.loader.registerStatic('app-shell', {}) }).toThrow('registered twice')
  })
})

describe('failure modes', () => {
  it('duplicate factory registration is loud', () => {
    bench([])
    win.__ModuleLoader__?.load({ id: 'x', factory: () => ({}) })
    expect(() => win.__ModuleLoader__?.load({ id: 'x', factory: () => ({}) }))
      .toThrow('duplicate factory registration for "x"')
  })

  it('a bundle that never registers its id is loud', async () => {
    const b = bench([row('a')], { a: null })
    await expect(b.loader.import('a', '', {})).rejects.toThrow('without registering "a"')
  })

  it('an unknown import specifier is loud', async () => {
    const b = bench([])
    await expect(b.loader.import('nope', '', {})).rejects.toThrow('cannot resolve "nope"')
  })

  it('an unknown prefetch id is loud', async () => {
    const b = bench([])
    await expect(b.loader.prefetch('nope')).rejects.toThrow('prefetch("nope") — not a graph entry')
  })

  it('a duplicate graph entry is loud at construction', () => {
    expect(() => bench([row('a'), row('a')])).toThrow('duplicate graph entry "a"')
  })

  it('double boot is loud', () => {
    bench([])
    expect(() => new ClientModuleSystem({ modules: [], staticModules: {} }))
      .toThrow('already installed (double boot?)')
  })
})

describe('HMR reset', () => {
  it('invalidate drops the factory and record so the module reloads and re-registers', async () => {
    let generation = 0
    const b = bench([row('a')], { a: () => ({ generation: ++generation }) })
    const first = await b.loader.import('a', '', {})
    b.loader.invalidate('a')
    expect(b.loader.loadCache.has('a')).toBe(false)
    await b.loader.prefetch('a')
    const second = await b.loader.import('a', '', {})
    expect(b.fetched).toHaveLength(2)
    expect((first as { generation: number }).generation).toBe(1)
    expect((second as { generation: number }).generation).toBe(2)
  })
})

describe('style claiming', () => {
  it('claims untagged style tags for the materializing plugin and inventories owned css ids', async () => {
    const foreign = document.createElement('style')
    foreign.setAttribute('data-plugin', 'other')
    document.head.appendChild(foreign)
    const b = bench([row('a')], {
      a: () => {
        document.head.appendChild(document.createElement('style'))
        const tagged = document.createElement('style')
        tagged.setAttribute('data-plugin', 'a')
        tagged.setAttribute('data-plugin-css', 'sheet-1')
        document.head.appendChild(tagged)
        return {}
      },
    })
    await b.loader.import('a', '', {})
    expect(b.loader.loadCache.get('a')?.styles).toEqual(['a', 'sheet-1'])
    expect(document.querySelectorAll('style[data-plugin="a"]')).toHaveLength(2)
    expect(foreign.getAttribute('data-plugin')).toBe('other')
  })

  it('materialization without a document skips the style inventory', async () => {
    const b = bench([row('a')], { a: () => ({}) })
    vi.stubGlobal('document', undefined)
    try {
      await b.loader.import('a', '', {})
    } finally {
      vi.unstubAllGlobals()
    }
    expect(b.loader.loadCache.get('a')?.styles).toEqual([])
  })
})

describe('default transport seam', () => {
  it('loads through an external classic script and removes the settled node', async () => {
    const append = vi.spyOn(document.head, 'append').mockImplementation((...nodes) => {
      const script = nodes[0]
      if (!(script instanceof HTMLScriptElement)) throw new Error('expected script node')
      expect(script.async).toBe(true)
      expect(script.getAttribute('src')).toBe('/plugins/dee/client.js?rev=0')
      queueMicrotask(() => {
        win.__ModuleLoader__?.load({ id: 'dee', factory: () => ({ marker: 'via-script' }) })
        script.dispatchEvent(new Event('load'))
      })
    })
    const loader: ClientModuleLoader = new ClientModuleSystem({ modules: [row('dee')], staticModules: {} })
    const exports = await loader.import('dee', '', {})
    expect((exports as { marker: string }).marker).toBe('via-script')
    expect(append).toHaveBeenCalledOnce()
    expect([...document.querySelectorAll('script')]).toEqual([])
  })

  it('a script load failure is loud and removes the node', async () => {
    vi.spyOn(document.head, 'append').mockImplementation((...nodes) => {
      const script = nodes[0]
      if (!(script instanceof HTMLScriptElement)) throw new Error('expected script node')
      queueMicrotask(() => { script.dispatchEvent(new Event('error')) })
    })
    const loader = new ClientModuleSystem({ modules: [row('dee')], staticModules: {} })
    await expect(loader.prefetch('dee')).rejects.toThrow(
      'bundle script /plugins/dee/client.js?rev=0 failed to load',
    )
    expect([...document.querySelectorAll('script')]).toEqual([])
  })
})
