import { describe, expect, it, vi } from 'vitest'
import type { RpcResponse } from '@deepseek-ai/dsh-api-remotes/client'
import { SettingsDocumentStore } from '../src/client/settings-document-store.ts'

function response(hasDocument = false): RpcResponse<{
  writable: boolean
  hasDocument: boolean
  namespaces: []
}> {
  return {
    rpcId: 'settings-document' as never,
    result: {
      ok: true,
      value: { writable: true, hasDocument, namespaces: [] },
    },
  }
}

function opened(): RpcResponse<{ opened: true }> {
  return {
    rpcId: 'settings-open' as never,
    result: { ok: true, value: { opened: true } },
  }
}

function describeFailed(message: string): RpcResponse<never> {
  return {
    rpcId: 'settings-document-failed' as never,
    result: { ok: false, error: { code: 'internal', message, details: {} } },
  }
}

describe('SettingsDocumentStore', () => {
  it('loads provider metadata and asks the settings domain to open its document', async () => {
    const describe = vi.fn(() => Promise.resolve(response(true)))
    const openDocument = vi.fn(() => Promise.resolve(opened()))
    const controller = new SettingsDocumentStore({ settings: { describe, openDocument } } as never)
    await controller.load()
    expect(controller.store.getSnapshot()).toEqual({
      status: 'ready', opening: false, error: null,
    })
    await controller.open()
    expect(openDocument).toHaveBeenCalledWith({})
  })

  it('marks absent or failed metadata unavailable without opening anything', async () => {
    const openDocument = vi.fn(() => Promise.resolve(opened()))
    const absent = new SettingsDocumentStore({
      settings: { describe: () => Promise.resolve(response()), openDocument },
    } as never)
    await absent.load()
    await absent.open()
    expect(absent.store.getSnapshot().status).toBe('unavailable')
    expect(openDocument).not.toHaveBeenCalled()

    const failed = new SettingsDocumentStore({
      settings: { describe: () => Promise.reject(new Error('offline')), openDocument },
    } as never)
    await failed.load()
    expect(failed.store.getSnapshot()).toMatchObject({ status: 'unavailable', error: 'offline' })

    const rejected = new SettingsDocumentStore({
      settings: { describe: () => Promise.resolve(describeFailed('provider failed')), openDocument },
    } as never)
    await rejected.load()
    expect(rejected.store.getSnapshot()).toMatchObject({
      status: 'unavailable', error: 'provider failed',
    })
  })

  it('collapses concurrent open gestures and recovers after a failure', async () => {
    let resolveOpen!: (response: RpcResponse<{ opened: true }>) => void
    const openDocument = vi.fn(() => new Promise<RpcResponse<{ opened: true }>>((resolve) => { resolveOpen = resolve }))
    const controller = new SettingsDocumentStore({
      settings: { describe: () => Promise.resolve(response(true)), openDocument },
    } as never)
    await controller.load()
    const first = controller.open()
    const second = controller.open()
    expect(openDocument).toHaveBeenCalledOnce()
    resolveOpen({
      rpcId: 'settings-open-failed' as never,
      result: { ok: false, error: { code: 'internal', message: 'no default editor', details: {} } },
    })
    await Promise.all([first, second])
    expect(controller.store.getSnapshot()).toMatchObject({
      status: 'ready', opening: false, error: 'no default editor',
    })
  })

  it('ignores stale metadata completions and reports non-Error native failures', async () => {
    let resolveFirst!: (value: ReturnType<typeof response>) => void
    const first = new Promise<ReturnType<typeof response>>((resolve) => { resolveFirst = resolve })
    const describe = vi.fn()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce(response(true))
    let rejectOpen!: (reason?: unknown) => void
    const controller = new SettingsDocumentStore({
      settings: {
        describe,
        openDocument: () => new Promise((_, reject) => { rejectOpen = reject }),
      },
    } as never)
    const stale = controller.load()
    await controller.load()
    resolveFirst(response())
    await stale
    expect(controller.store.getSnapshot().status).toBe('ready')
    const opening = controller.open()
    rejectOpen('native unavailable')
    await opening
    expect(controller.store.getSnapshot()).toMatchObject({
      status: 'ready', opening: false, error: 'native unavailable',
    })

    let rejectFirst!: (error: Error) => void
    const rejectedFirst = new Promise<ReturnType<typeof response>>((_, reject) => { rejectFirst = reject })
    const caught = new SettingsDocumentStore({
      settings: {
        describe: vi.fn()
          .mockReturnValueOnce(rejectedFirst)
          .mockResolvedValueOnce(response(true)),
        openDocument: vi.fn(),
      },
    } as never)
    const staleRejection = caught.load()
    await caught.load()
    rejectFirst(new Error('stale offline'))
    await staleRejection
    expect(caught.store.getSnapshot()).toMatchObject({ status: 'ready', error: null })
  })
})
