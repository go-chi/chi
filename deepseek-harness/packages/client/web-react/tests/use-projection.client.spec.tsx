// @vitest-environment jsdom
/**
 * useProjection standard-kit delivery (session-projection subsystem page:
 * docs/subsystems/session-projection.md): the fifth
 * framework hook seat rides the same provide channel as useSession — a
 * session slot component receives `useProjection` in its kit, key-addressed
 * over the bundle's projection face; unresolved keys (no value, no face, no
 * session) uniformly read `undefined`; live value changes re-render; the
 * selector overload runs over the whole value.
 */
import { describe, expect, it } from 'vitest'
import { act, render } from '@testing-library/react'
import type { SessionMaybeProvideInfo, StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import { createSlotRenderer, type SlotRendererHost } from '@deepseek-ai/dsh-client-web-react'

function observable<T>(initial: T) {
  let value = initial
  const subs = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe: (fn: () => void) => { subs.add(fn); return () => { subs.delete(fn) } },
    set: (next: T) => { value = next; for (const fn of [...subs]) fn() },
  }
}

type UseProjectionProp = (key: string, selector?: (v: unknown) => unknown) => unknown

function makeHost() {
  const absentInfo: SessionMaybeProvideInfo = { sessionId: undefined, hooks: { session: undefined }, props: {} }
  const provide = observable<SessionMaybeProvideInfo>(absentInfo)
  const cells = new Map<string, ReturnType<typeof observable<unknown>>>()
  /** Store-parallel face: always defined per key; an unseen key snapshots undefined. */
  const absent = { getSnapshot: () => undefined, subscribe: () => () => {} }
  const sessionEntries: StoredEntry[] = []
  let withFace = true
  const rootEntry: StoredEntry = {
    component: (props: { renderSlot: (key: string, owner: object) => React.ReactNode }) =>
      <>{props.renderSlot('k.session', {})}</>,
    options: {},
    children: { 'k.session': { kind: 'single', scope: 'session' } },
  }
  const info = (id: string): SessionMaybeProvideInfo => ({
    sessionId: id,
    hooks: { session: { getSnapshot: () => ({ sid: id }), subscribe: () => () => {} } },
    props: {},
    ...(withFace ? { projections: { faceOf: (key: string) => cells.get(key) ?? absent } } : {}),
  })
  const host: SlotRendererHost = {
    subscribe: () => () => {},
    getVersion: () => 0,
    entriesOf: key => key === 'root' ? [rootEntry] : sessionEntries,
    // Single-kind everywhere and no crashes in this suite: the projection is
    // the raw view and crash reports never fire.
    entriesOfSlot: key => key === 'root' ? [rootEntry] : sessionEntries,
    reportEntryError: () => {},
    specOf: key => key === 'k.session' ? { kind: 'single', scope: 'session' } : undefined,
    isLive: () => true,
    storeOf: () => undefined,
    sessions: {
      list: observable<unknown>({ ids: [] }),
      provideInfo: provide,
    },
    workspaces: { list: observable<unknown>({ items: [] }) },
  }
  return {
    host,
    cells,
    // Same driver surface as before the atomic provide source: set(id)
    // publishes the resolved bundle (or the absent projection) through it.
    current: { set: (id: string | undefined) => { provide.set(id === undefined ? absentInfo : info(id)) } },
    dropFace: () => { withFace = false },
    registerSession: (entry: StoredEntry) => { sessionEntries.push(entry) },
  }
}

describe('useProjection standard-kit delivery', () => {
  it('reads the projected value through the kit, undefined for unresolved keys, and follows live changes', () => {
    const h = makeHost()
    const cell = observable<unknown>({ marks: ['a'] })
    h.cells.set('test/marks', cell)
    const reads: Record<string, unknown>[] = []
    h.registerSession({
      component: (props: { useProjection: UseProjectionProp }) => {
        reads.push({
          marks: props.useProjection('test/marks'),
          ghost: props.useProjection('test/ghost'),
        })
        return null
      },
      options: {},
    })
    render(<>{createSlotRenderer().renderRoot(h.host, {})}</>)
    act(() => { h.current.set('s1') })
    expect(reads.at(-1)).toEqual({ marks: { marks: ['a'] }, ghost: undefined })
    // Live change re-renders with the new whole value.
    act(() => { cell.set({ marks: ['a', 'b'] }) })
    expect(reads.at(-1)).toEqual({ marks: { marks: ['a', 'b'] }, ghost: undefined })
  })

  it('runs the selector overload over the whole value (and over undefined when absent)', () => {
    const h = makeHost()
    h.cells.set('test/marks', observable<unknown>({ marks: ['x', 'y'] }))
    const reads: unknown[] = []
    h.registerSession({
      component: (props: { useProjection: UseProjectionProp }) => {
        reads.push(props.useProjection('test/marks', v => (v as { marks: string[] } | undefined)?.marks.length ?? -1))
        reads.push(props.useProjection('test/ghost', v => (v === undefined ? 'absent' : 'present')))
        return null
      },
      options: {},
    })
    render(<>{createSlotRenderer().renderRoot(h.host, {})}</>)
    act(() => { h.current.set('s1') })
    expect(reads.slice(-2)).toEqual([2, 'absent'])
  })

  it('treats a bundle without the projections face as all-absent (capability absence)', () => {
    const h = makeHost()
    h.cells.set('test/marks', observable<unknown>({ marks: ['a'] }))
    h.dropFace()
    const reads: unknown[] = []
    h.registerSession({
      component: (props: { useProjection: UseProjectionProp }) => {
        reads.push(props.useProjection('test/marks'))
        return null
      },
      options: {},
    })
    render(<>{createSlotRenderer().renderRoot(h.host, {})}</>)
    act(() => { h.current.set('s1') })
    expect(reads.at(-1)).toBeUndefined()
  })
})
