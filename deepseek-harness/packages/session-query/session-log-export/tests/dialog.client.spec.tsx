// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSyncExternalStore } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { SessionLogDownloadController } from '../src/client/controller.ts'
import { SessionLogDownloadDialog } from '../src/client/Dialog.tsx'
import type { SessionLogDownloadDialogProps } from '../src/client/Dialog.tsx'
import { en } from '../src/client/locales.ts'

const SID = 'session-export-dialog' as SessionId

function bench(
  controller = new SessionLogDownloadController(
    async () => new Response('zip', { status: 200 }), vi.fn(),
  ),
) {
  const dismiss = vi.fn((sessionId: SessionId) => { controller.dismiss(sessionId) })
  function useSessionLogDownload<T>(selector: (state: ReturnType<typeof controller.store.getSnapshot>) => T): T {
    return useSyncExternalStore(
      listener => controller.store.subscribe(listener),
      () => selector(controller.store.getSnapshot()),
    )
  }
  const t = (key: keyof typeof en): string => en[key]
  const props = { sessionId: SID, useSessionLogDownload, dismiss, t } as unknown as SessionLogDownloadDialogProps
  const view = render(<SessionLogDownloadDialog {...props} />)
  return { controller, dismiss, view }
}

afterEach(cleanup)

describe('SessionLogDownloadDialog', () => {
  it('shows a controller failure and closes it without reading Session history', async () => {
    const b = bench()
    act(() => {
      b.controller.store.set({
        bySession: { [SID]: { open: true, status: 'error', error: 'toolbar failed' } },
      })
    })
    const dialog = await b.view.findByRole('dialog', { name: 'Session export failed' })
    expect(dialog.textContent).toContain('toolbar failed')
    const close = b.view.getAllByRole('button', { name: 'Close' })[0]
    if (close === undefined) throw new Error('Session export dialog has no close button')
    fireEvent.click(close)
    await waitFor(() => { expect(b.dismiss).toHaveBeenCalledWith(SID) })
  })

  it('renders the in-flight state and the settled browser download state', async () => {
    let release!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => { release = resolve })
    const controller = new SessionLogDownloadController(() => pending, vi.fn())
    const b = bench(controller)

    const download = controller.download(SID)
    expect(await b.view.findByRole('dialog', { name: 'Exporting Session' })).toBeTruthy()
    release(new Response('zip', { status: 200 }))
    await download
    expect(await b.view.findByRole('dialog', { name: 'Session download started' })).toBeTruthy()
  })

  it('uses fallback copy when a failure has no detail', async () => {
    const b = bench()
    act(() => {
      b.controller.store.set({
        bySession: { [SID]: { open: true, status: 'error', error: '' } },
      })
    })
    const dialog = await b.view.findByRole('dialog', { name: 'Session export failed' })
    expect(dialog.textContent).toContain('Could not start the Session export.')
    const close = b.view.getAllByRole('button', { name: 'Close' }).at(-1)
    if (close === undefined) throw new Error('Session export dialog has no footer action')
    fireEvent.click(close)
    await waitFor(() => { expect(b.dismiss).toHaveBeenCalledWith(SID) })
  })
})
