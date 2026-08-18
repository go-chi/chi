// @vitest-environment jsdom
/** LanguageRow behavior: selector pill shows the active locale, the menu
 * opens/closes, and selection drives setLocale. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createSnapshotStore, type SessionListState, type WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { LanguageRow } from '../src/client/LanguageRow.tsx'
import type { LanguageRowComponentProps } from '../src/client/LanguageRow.tsx'
import { createLanguageRowStore } from '../src/client/settings-store.ts'

afterEach(cleanup)

const OPTIONS = [{ id: 'zh', label: '中文' }, { id: 'en', label: 'English' }]

/** Empty global standard-kit hooks (the row reads neither). */
function emptySessions() {
  const store = createSnapshotStore<SessionListState>(
    { ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined })
  return bindSnapshotSelector(store)
}
function emptyWorkspaces() {
  const store = createSnapshotStore<WorkspaceListState>({
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    baselinesReady: true, recentWorkspaceId: undefined,
  })
  return bindSnapshotSelector(store)
}

function mount(active = 'en') {
  // Real store instance — the sanctioned zero-machinery path for tests.
  const store = createLanguageRowStore().create()
  store.actions.sync(active, OPTIONS, 0)
  const setLocale = vi.fn()
  const props: LanguageRowComponentProps = {
    useSessions: emptySessions(),
    useWorkspaces: emptyWorkspaces(),
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    t: (key: string) => key === 'language.title' ? 'Language' : key,
    setLocale,
  }
  render(<LanguageRow {...props} />)
  return { store, setLocale }
}

describe('LanguageRow', () => {
  it('shows the title and the active locale label on the selector pill', () => {
    mount('en')
    expect(screen.getByText('Language')).toBeDefined()
    const trigger = screen.getByRole('button', { name: /English/ })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('opens the menu, selects a locale, and closes', () => {
    const b = mount('en')
    const trigger = screen.getByRole('button', { name: /English/ })
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByRole('menuitem', { name: '中文' }))
    expect(b.setLocale).toHaveBeenCalledWith('zh')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('menuitem', { name: '中文' })).toBeNull()
  })

  it('closes on outside pointerdown without selecting', () => {
    const b = mount('en')
    fireEvent.click(screen.getByRole('button', { name: /English/ }))
    expect(screen.getByRole('menuitem', { name: '中文' })).toBeDefined()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menuitem', { name: '中文' })).toBeNull()
    expect(b.setLocale).not.toHaveBeenCalled()
  })

  it('follows store changes; an unknown active id falls back to the id itself', () => {
    const b = mount('en')
    act(() => { b.store.actions.sync('zh', OPTIONS, 1) })
    expect(screen.getByRole('button', { name: /中文/ })).toBeDefined()
    act(() => { b.store.actions.sync('fr', OPTIONS, 2) })
    expect(screen.getByRole('button', { name: /fr/ })).toBeDefined()
  })
})
