/**
 * The koffi-backed bindings against a mocked `koffi` module (the same
 * technique as dsh-session-persistence-jsonl's win32 suite): a small in-memory
 * COM world stands in for ole32/user32/kernel32, keeping the vtable dispatch,
 * result extraction, memory hygiene, and the WM_CLOSE poster covered on every
 * host. The worker entry is exercised the same way with a mocked process
 * boundary (env title + `process.send`). Real-COM behavior is pinned by the
 * win32-only smoke in win32-dialog.spec.ts.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { HRESULT_CANCELLED, runFolderDialog } from '../src/win32-dialog-logic.ts'

const E_FAIL = 0x80004005 | 0
const WM_CLOSE = 0x10
/**
 * Deliberately NOT 8: the bindings must derive vtable offsets and out-buffer
 * sizes from koffi.sizeof('void *'), and a hardcoded 8 anywhere fails against
 * this width (the win32-ia32 bug class).
 */
const FAKE_POINTER_SIZE = 4

interface ComWorld {
  coInitHr: number
  coCreateHr: number
  showHr: number
  getResultHr: number
  getDisplayNameHr: number
  hasThreadDpi: boolean
  /** Contexts `SetThreadDpiAwarenessContext` accepts; others return NULL. */
  supportedDpiContexts: number[]
  enumThrows: boolean
  path: string
  titles: string[]
  options: number[]
  dpiContexts: unknown[]
  freed: unknown[]
  released: string[]
  posted: { hwnd: unknown; message: number }[]
  registered: number
  unregistered: number
  uninitialized: number
}

function comWorld(overrides: Partial<ComWorld> = {}): ComWorld {
  return {
    coInitHr: 0, coCreateHr: 0, showHr: 0, getResultHr: 0, getDisplayNameHr: 0,
    hasThreadDpi: true, supportedDpiContexts: [-4], enumThrows: false,
    path: 'C:\\选中\\directory',
    titles: [], options: [], dpiContexts: [], freed: [], released: [], posted: [],
    registered: 0, unregistered: 0, uninitialized: 0,
    ...overrides,
  }
}

/** Sentinel pointer objects standing in for native addresses. */
interface FakePtr { kind: string; [key: string]: unknown }

function installFakeKoffi(world: ComWorld): void {
  const dialogPtr: FakePtr = { kind: 'dialog' }
  const itemPtr: FakePtr = { kind: 'item' }
  const namePtr: FakePtr = { kind: 'name', text: world.path }
  const outBuffers = new Map<unknown, FakePtr>()

  const dispatch = (self: FakePtr, slot: number, args: unknown[]): number => {
    if (self.kind === 'dialog') {
      switch (slot) {
        case 9: world.options.push(args[0] as number); return 0
        case 17: world.titles.push(args[0] as string); return 0
        case 3: return world.showHr
        case 20: {
          if (world.getResultHr < 0) return world.getResultHr
          ;(args[0] as unknown[])[0] = itemPtr
          return 0
        }
        case 2: world.released.push('dialog'); return 0
        default: throw new Error(`unexpected dialog slot ${slot}`)
      }
    }
    switch (slot) {
      case 5: {
        if (world.getDisplayNameHr < 0) return world.getDisplayNameHr
        ;(args[1] as unknown[])[0] = namePtr
        return 0
      }
      case 2: world.released.push('item'); return 0
      default: throw new Error(`unexpected item slot ${slot}`)
    }
  }

  vi.doMock('koffi', () => ({
    default: {
      load: (dll: string) => ({
        func: (_convention: string, name: string, _result: string, _args: string[]) => {
          switch (name) {
            case 'CoInitializeEx': return () => world.coInitHr
            case 'CoUninitialize': return () => { world.uninitialized += 1 }
            case 'CoCreateInstance': return (...args: unknown[]) => {
              if (world.coCreateHr < 0) return world.coCreateHr
              // The out-pointer must be allocated at the fake's pointer width.
              if ((args[4] as Buffer).length !== FAKE_POINTER_SIZE) {
                throw new Error(`CoCreateInstance out buffer must be ${FAKE_POINTER_SIZE} bytes`)
              }
              outBuffers.set(args[4], dialogPtr)
              return 0
            }
            case 'CoTaskMemFree': return (ptr: unknown) => { world.freed.push(ptr) }
            case 'GetCurrentThreadId': return () => 31337
            case 'SetThreadDpiAwarenessContext': {
              if (!world.hasThreadDpi) throw new Error(`${dll}: SetThreadDpiAwarenessContext not found`)
              return (context: unknown) => {
                world.dpiContexts.push(context)
                return world.supportedDpiContexts.includes(context as number) ? { kind: 'previous-context' } : null
              }
            }
            case 'EnumThreadWindows': return (_tid: unknown, callback: { fn: (hwnd: unknown, lparam: unknown) => number }, lparam: unknown) => {
              if (world.enumThrows) throw new Error('EnumThreadWindows refused')
              callback.fn({ kind: 'hwnd', n: 1 }, lparam)
              callback.fn({ kind: 'hwnd', n: 2 }, lparam)
              return 1
            }
            case 'PostMessageW': return (hwnd: unknown, message: number) => { world.posted.push({ hwnd, message }); return 1 }
            default: throw new Error(`unexpected native import ${dll}/${name}`)
          }
        },
      }),
      proto: (declaration: string) => ({ declaration }),
      pointer: (type: unknown) => type,
      sizeof: (type: string) => { void type; return FAKE_POINTER_SIZE },
      view: (value: unknown, len: number): ArrayBuffer => {
        const bytes = Buffer.alloc(len)
        bytes.write((value as FakePtr).text as string, 'utf16le')
        return bytes.buffer
      },
      register: (fn: (hwnd: unknown, lparam: unknown) => number) => { world.registered += 1; return { fn } },
      unregister: () => { world.unregistered += 1 },
      decode: (value: unknown, offsetOrType: unknown): unknown => {
        if (offsetOrType === 'str16') return (value as FakePtr).text
        if (typeof offsetOrType === 'number') {
          // Vtable slot read: offsets must be multiples of the fake width.
          if (offsetOrType % FAKE_POINTER_SIZE !== 0) throw new Error(`vtable offset ${offsetOrType} is not pointer-aligned`)
          const owner = (value as { owner: FakePtr }).owner
          return { call: (args: unknown[]) => dispatch(owner, offsetOrType / FAKE_POINTER_SIZE, args) }
        }
        // decode(x, 'void *'): out-buffer read or vtable read.
        if (outBuffers.has(value)) return outBuffers.get(value)
        return { owner: value as FakePtr }
      },
      call: (fn: { call: (args: unknown[]) => number }, _proto: unknown, _self: unknown, ...args: unknown[]) => fn.call(args),
    },
  }))
}

async function loadBindingsModule(): Promise<typeof import('../src/win32-dialog-bindings.ts')> {
  return await import('../src/win32-dialog-bindings.ts')
}

afterEach(() => {
  vi.doUnmock('koffi')
  vi.doUnmock('node:worker_threads')
  vi.doUnmock('../src/win32-dialog-bindings.ts')
  vi.resetModules()
})

describe('loadWin32DialogBindings over the fake COM world', () => {
  it('drives the full selection conversation with memory hygiene', async () => {
    const world = comWorld()
    installFakeKoffi(world)
    const { loadWin32DialogBindings } = await loadBindingsModule()
    const bindings = await loadWin32DialogBindings()
    const showing = vi.fn()

    expect(runFolderDialog(bindings, '选择工作区目录', showing)).toBe('C:\\选中\\directory')
    expect(world.dpiContexts).toEqual([-4])
    expect(world.titles).toEqual(['选择工作区目录'])
    expect(world.options).toHaveLength(1)
    expect(showing).toHaveBeenCalledWith(31337)
    expect(world.freed).toHaveLength(1)
    expect(world.released).toEqual(['item', 'dialog'])
    expect(world.uninitialized).toBe(1)
  })

  it('maps dismissal and the S_FALSE CoInitializeEx', async () => {
    const world = comWorld({ showHr: HRESULT_CANCELLED, coInitHr: 1 })
    installFakeKoffi(world)
    const { loadWin32DialogBindings } = await loadBindingsModule()
    const bindings = await loadWin32DialogBindings()
    expect(runFolderDialog(bindings, 'Pick', vi.fn())).toBeNull()
    expect(world.released).toEqual(['dialog'])
    expect(world.uninitialized).toBe(1)
  })

  it('cascades DPI contexts to the first the host accepts', async () => {
    const world = comWorld({ supportedDpiContexts: [-3] })
    installFakeKoffi(world)
    const bindings = await (await loadBindingsModule()).loadWin32DialogBindings()
    expect(runFolderDialog(bindings, 'Pick', vi.fn())).toBe('C:\\选中\\directory')
    expect(world.dpiContexts).toEqual([-4, -3])
  })

  it('keeps the tier when no DPI context is accepted or the symbol is absent', async () => {
    // DPI is a cosmetic best-effort: the modern dialog still opens.
    const rejecting = comWorld({ supportedDpiContexts: [] })
    installFakeKoffi(rejecting)
    let bindings = await (await loadBindingsModule()).loadWin32DialogBindings()
    expect(runFolderDialog(bindings, 'Pick', vi.fn())).toBe('C:\\选中\\directory')
    expect(rejecting.dpiContexts).toEqual([-4, -3, -2])

    vi.doUnmock('koffi')
    vi.resetModules()
    const preThreadDpi = comWorld({ hasThreadDpi: false })
    installFakeKoffi(preThreadDpi)
    bindings = await (await loadBindingsModule()).loadWin32DialogBindings()
    expect(runFolderDialog(bindings, 'Pick', vi.fn())).toBe('C:\\选中\\directory')
    expect(preThreadDpi.dpiContexts).toEqual([])
  })

  it('surfaces creation and extraction failures as HRESULT errors', async () => {
    const creationWorld = comWorld({ coCreateHr: E_FAIL })
    installFakeKoffi(creationWorld)
    let bindings = await (await loadBindingsModule()).loadWin32DialogBindings()
    expect(() => bindings.createFolderDialog()).toThrow('CoCreateInstance(FileOpenDialog) failed: HRESULT 0x80004005')

    vi.doUnmock('koffi')
    vi.resetModules()
    const resultWorld = comWorld({ getResultHr: E_FAIL })
    installFakeKoffi(resultWorld)
    bindings = await (await loadBindingsModule()).loadWin32DialogBindings()
    expect(() => runFolderDialog(bindings, 'Pick', vi.fn())).toThrow('GetResult failed')
    expect(resultWorld.released).toEqual(['dialog'])

    vi.doUnmock('koffi')
    vi.resetModules()
    const nameWorld = comWorld({ getDisplayNameHr: E_FAIL })
    installFakeKoffi(nameWorld)
    bindings = await (await loadBindingsModule()).loadWin32DialogBindings()
    expect(() => runFolderDialog(bindings, 'Pick', vi.fn())).toThrow('GetResult failed')
    // The shell item is released even when its display name cannot be read.
    expect(nameWorld.released).toEqual(['item', 'dialog'])
    expect(nameWorld.freed).toHaveLength(0)
  })
})

describe('closeThreadWindows over the fake COM world', () => {
  it('posts WM_CLOSE to every window of the thread and unregisters the callback', async () => {
    const world = comWorld()
    installFakeKoffi(world)
    const { closeThreadWindows } = await loadBindingsModule()
    await closeThreadWindows(777)
    expect(world.posted).toEqual([
      { hwnd: { kind: 'hwnd', n: 1 }, message: WM_CLOSE },
      { hwnd: { kind: 'hwnd', n: 2 }, message: WM_CLOSE },
    ])
    expect(world.registered).toBe(1)
    expect(world.unregistered).toBe(1)
  })

  it('unregisters the callback even when the enumeration itself throws', async () => {
    const world = comWorld({ enumThrows: true })
    installFakeKoffi(world)
    const { closeThreadWindows } = await loadBindingsModule()
    await expect(closeThreadWindows(777)).rejects.toThrow('EnumThreadWindows refused')
    expect(world.unregistered).toBe(1)
  })
})

describe('the worker entry over a mocked process boundary', () => {
  const originalSend = process.send?.bind(process)
  const originalTitle = process.env.DSH_DIALOG_TITLE

  const installBoundary = (): { posted: { kind: string; message?: string }[] } => {
    const posted: { kind: string; message?: string }[] = []
    process.env.DSH_DIALOG_TITLE = 'Pick'
    // Never invoke the post callback: it runs the worker's disconnect(), and
    // this process is IPC-connected under the forks pool — severing vitest's
    // own channel would kill the test worker. The real close lifecycle
    // belongs to built-worker.e2e.ts.
    ;(process as { send?: unknown }).send = (message: { kind: string }) => {
      posted.push(message)
      return true
    }
    return { posted }
  }

  afterEach(() => {
    delete (process as { send?: unknown }).send
    if (originalSend !== undefined) (process as { send?: unknown }).send = originalSend
    if (originalTitle === undefined) delete process.env.DSH_DIALOG_TITLE
    else process.env.DSH_DIALOG_TITLE = originalTitle
    vi.doUnmock('../src/win32-dialog-bindings.ts')
    vi.resetModules()
  })

  it('posts showing then done for a completed conversation', async () => {
    const { posted } = installBoundary()
    vi.doMock('../src/win32-dialog-bindings.ts', () => ({
      loadWin32DialogBindings: async () => ({
        setThreadDpiAwareness: () => undefined,
        coInitializeSta: () => 0,
        coUninitialize: () => undefined,
        currentThreadId: () => 11,
        createFolderDialog: () => ({
          setOptions: () => 0,
          setTitle: () => 0,
          show: () => 0,
          resultPath: () => ({ hr: 0, path: 'C:\\from-worker' }),
          release: () => undefined,
        }),
      }),
    }))
    await import('../src/win32-dialog-worker.ts')
    expect(posted).toEqual([
      { kind: 'showing', threadId: 11 },
      { kind: 'done', path: 'C:\\from-worker' },
    ])
  })

  it('posts the failure message when the native surface cannot load', async () => {
    const { posted } = installBoundary()
    vi.doMock('../src/win32-dialog-bindings.ts', () => ({
      loadWin32DialogBindings: async () => { throw new Error('no ole32 here') },
    }))
    await import('../src/win32-dialog-worker.ts')
    expect(posted).toHaveLength(1)
    expect(posted[0]?.kind).toBe('error')
    expect(posted[0]?.message).toContain('no ole32 here')
  })

  it('stringifies stackless and non-Error failures', async () => {
    const stackless = new Error('bare message')
    delete stackless.stack
    for (const [thrown, expected] of [[stackless, 'bare message'], ['plain refusal', 'plain refusal']] as const) {
      vi.resetModules()
      const { posted } = installBoundary()
      vi.doMock('../src/win32-dialog-bindings.ts', () => ({
        loadWin32DialogBindings: async () => { throw thrown },
      }))
      await import('../src/win32-dialog-worker.ts')
      expect(posted[0]?.message).toBe(expected)
    }
  })

  it('refuses to run without the dialog title', async () => {
    delete process.env.DSH_DIALOG_TITLE
    ;(process as { send?: unknown }).send = () => true
    await expect(import('../src/win32-dialog-worker.ts')).rejects.toThrow('DSH_DIALOG_TITLE is required')
  })

  it('refuses to run outside a child process', async () => {
    process.env.DSH_DIALOG_TITLE = 'Pick'
    delete (process as { send?: unknown }).send
    await expect(import('../src/win32-dialog-worker.ts')).rejects.toThrow('must run as a child process')
  })
})
