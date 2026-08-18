// Terminal-design compile-time samples: the four-share
// composed register constraint — children spec x SlotMap alignment, renderSlot
// key-set containment, store share matching, inject face completeness — plus
// the full positive chain. Bodies with @ts-expect-error sites never run.
import { describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'
import type {
  BoundActions, DefineStore, PropsRenderSlots, PropsRuntime, PropsStore, SlotComponent, SlotHookFactory,
} from '@deepseek-ai/dsh-client-ui-slots'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'

// Only package-unique SlotMap keys are merged here. The standard-kit
// interfaces (SessionStandardProps/GlobalStandardProps) are NOT re-merged:
// the runtime package owns the real members, and in the client aggregate
// program a toy merge would collide with them — samples below stay
// shape-agnostic about kit member payloads for the same reason.
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'chain.frame': { kind: 'single'; scope: 'root' }
    'chain.side': { kind: 'single'; scope: 'root'; owner: { collapsed: boolean; width: number } }
    'chain.conv': { kind: 'single'; scope: 'session' }
    'chain.context': {
      kind: 'single'
      scope: 'session'
      hookContext: string
      inject: ContextInjected
    }
    'chain.tools': { kind: 'keyed'; scope: 'session' }
    'chain.takeover': { kind: 'chain'; scope: 'session'; owner: { items: readonly Item[] } }
  }
}

/** Chain-currency fixture: the owner share carries a union the selectors narrow. */
interface Item { kind: 'q' | 'a'; id: string }

declare const defineStore: DefineStore

/** Factory form (exclusive seat): module-level export, never a handle. */
function createPanelStore() {
  return defineStore({
    init: () => ({ sidebar: 280, details: 0 }),
    persist: 'test.panels',
    actions: {
      setSidebar: (d, px: number) => { d.sidebar = px },
      setDetails: (d, px: number) => { d.details = px },
    },
  })
}

const _chatStore = () => defineStore({
  init: () => ({ selection: null as { id: string } | null, draft: '' }),
  actions: {
    select: (d, t: { id: string }) => { d.selection = t },
    setDraft: (d, text: string) => { d.draft = text },
    clearDraft: (d) => { d.draft = '' },
  },
})
type ChatHandle = ReturnType<typeof _chatStore>

type FrameProps =
  & PropsRuntime<'chain.frame'>
  & PropsRenderSlots<'chain.side' | 'chain.conv'>
  & PropsStore<ReturnType<typeof createPanelStore>>
  & { openSettings: () => void }

type ConvProps =
  & PropsRuntime<'chain.conv'>
  & PropsStore<ChatHandle>
  & { send: (t: string) => void }

interface TurnDataMap { tail: string; files: string }
type UseTurnData = <Key extends keyof TurnDataMap>(key: Key) => TurnDataMap[Key] | undefined
interface ContextInjected {
  hooks: {
    turnData: SlotHookFactory<'chain.context', UseTurnData>
  }
}
type ContextProps = PropsRuntime<'chain.context'>
const CONTEXT_INJECT: ContextInjected = {
  hooks: {
    turnData: (_standard, hookContext) => {
      const id: string = hookContext
      return key => id === '' ? undefined : ({ tail: 'tail', files: 'files' })[key]
    },
  },
}

// Component fixtures (never rendered; the register call sites are the test).
declare function Frame(props: FrameProps): ReactNode
declare function Conv(props: ConvProps): ReactNode
declare function Details(props: PropsRuntime<'chain.conv'> & PropsStore<ChatHandle>): ReactNode
declare function Tool(props: PropsRuntime<'chain.tools'>): ReactNode
declare function Over(props: PropsRuntime<'chain.frame'> & PropsRenderSlots<'chain.side' | 'chain.conv'>): ReactNode
declare function NoDecl(props: PropsRuntime<'chain.frame'> & PropsRenderSlots<'chain.side'>): ReactNode
declare function Blind(props: PropsRuntime<'chain.frame'>): ReactNode
declare function WrongStore(props: PropsRuntime<'chain.conv'> & PropsStore<ReturnType<typeof createPanelStore>>): ReactNode
declare function Needs(props: PropsRuntime<'chain.conv'> & { send: (t: string) => void }): ReactNode
declare function ContextOwner(props: PropsRuntime<'chain.frame'> & PropsRenderSlots<'chain.context'>): ReactNode
declare function ContextReader(props: ContextProps): ReactNode
declare function Takeover(props: PropsRuntime<'chain.takeover'> & { matched: Item }): ReactNode
declare function WideTakeover(props: PropsRuntime<'chain.takeover'> & { matched: Item | string }): ReactNode
declare function NarrowTakeover(props: PropsRuntime<'chain.takeover'> & { matched: { kind: 'q'; id: string; extra: number } }): ReactNode

describe('terminal-design type chain', () => {
  it('holds the positive chain and the compile-time negatives', () => {
    // Everything below is compile-time only.
    const samples = (core: SlotCore, chat: ChatHandle, fp: FrameProps, cp: ConvProps, acts: BoundActions<ChatHandle>) => {
      // ── positive chain ─────────────────────────────────────────────
      // Frame: children + factory store + inject; actions arrive baked.
      core.register({
        name: 'chain.frame',
        children: {
          'chain.side': { kind: 'single', scope: 'root' },
          'chain.conv': { kind: 'single', scope: 'session' },
        },
        store: createPanelStore,
        inject: (actions) => {
          actions.setSidebar(0)
          return { openSettings: () => {} }
        },
      }, Frame)

      // Conv: shared handle; inject params derive as (sessionId, actions).
      core.register({
        name: 'chain.conv',
        store: chat,
        inject: (sessionId, actions) => ({
          send: (text: string) => {
            const sid: string = sessionId
            actions.setDraft(text)
            void sid
          },
        }),
      }, Conv)

      // Pure reader: same handle, no inject.
      core.register({ name: 'chain.conv', store: chat }, Details)

      // Owner + store shares arrive typed on the component face. Standard-kit
      // member payloads are the runtime merge's property — not probed here
      // (the runtime package's own tests cover them).
      fp.renderSlot('chain.side', { collapsed: false, width: 280 })
      const draft: string = cp.useStore(s => s.draft)
      cp.actions.select({ id: 'm1' })
      void draft

      // Keyed registration carries key.
      core.register({ name: 'chain.tools', key: 'bash' }, Tool)

      // Chain registration: select is mandatory, M infers from its return,
      // matched joins the component constraint; priority is the explicit
      // chain position.
      core.register({
        name: 'chain.takeover',
        select: ({ items }) => items.find(i => i.kind === 'q') ?? null,
        priority: 1,
      }, Takeover)

      // A component accepting a wider matched than the selector supplies
      // checks through parameter contravariance.
      core.register({
        name: 'chain.takeover',
        select: ({ items }) => items.find(i => i.kind === 'q') ?? null,
      }, WideTakeover)

      // renderSlotChain share: chain keys dispatch with the fallback bag;
      // non-chain keys stay on renderSlot.
      const chainSlots: PropsRenderSlots<'chain.takeover' | 'chain.conv'> = null as never
      chainSlots.renderSlotChain('chain.takeover', { items: [] }, { fallback: null })
      chainSlots.renderSlot('chain.conv', {})

      // A parent registration declares the Slot inject once; every child
      // entry receives the same custom Hook, bound to official standard props
      // and each render occurrence's opaque context.
      core.register({
        name: 'chain.frame',
        children: {
          'chain.context': { kind: 'single', scope: 'session', inject: CONTEXT_INJECT },
        },
      }, ContextOwner)
      core.register({ name: 'chain.context' }, ContextReader)
      const contextProps: ContextProps = null as never
      const tail: string | undefined = contextProps.useTurnData('tail')
      const contextSlots: PropsRenderSlots<'chain.context'> = null as never
      contextSlots.renderSlot('chain.context', {}, {
        hookContext: 'turn:1',
      })
      void tail

      // ── negatives ──────────────────────────────────────────────────
      // children spec must match the SlotMap entry.
      core.register({
        name: 'chain.frame',
        // @ts-expect-error chain.conv is session-scoped in SlotMap
        children: { 'chain.conv': { kind: 'single', scope: 'root' } },
      }, (() => null) as SlotComponent<never>)
      core.register({
        name: 'chain.frame',
        // @ts-expect-error chain.context requires its Slot-level inject declaration
        children: { 'chain.context': { kind: 'single', scope: 'session' } },
      }, ContextOwner)

      // renderSlot key set ⊄ children declaration.
      // @ts-expect-error component renderSlot keys exceed the declaration
      core.register({ name: 'chain.frame', children: { 'chain.side': { kind: 'single', scope: 'root' } } }, Over)

      // renderSlot consumption without any children declaration.
      // @ts-expect-error no children declaration authorizes rendering
      core.register({ name: 'chain.frame' }, NoDecl)

      // children declared but component consumes no renderSlot.
      // @ts-expect-error children declared, component consumes no renderSlot
      core.register({ name: 'chain.frame', children: { 'chain.side': { kind: 'single', scope: 'root' } } }, Blind)

      // store share mismatch.
      // @ts-expect-error component's store share doesn't match the declared handle
      core.register({ name: 'chain.conv', store: chat }, WrongStore)

      // inject face incomplete for the component's business share.
      // @ts-expect-error inject face missing `send`
      core.register({ name: 'chain.conv', inject: () => ({ notSend: 1 }) }, Needs)
      // @ts-expect-error nothing provides `send` (no inject at all)
      core.register({ name: 'chain.conv' }, Needs)

      // root-scope inject takes no sessionId.
      core.register({
        name: 'chain.side',
        // @ts-expect-error root-scope inject has no sessionId parameter
        inject: (sessionId: string) => ({ x: sessionId }),
      }, (_p => null) as SlotComponent<PropsRuntime<'chain.side'> & { x: string }>)

      // keyed registration without key.
      // @ts-expect-error keyed registration requires options.key
      core.register({ name: 'chain.tools' }, Tool)

      // chain registration without select.
      // @ts-expect-error chain registration requires options.select
      core.register({ name: 'chain.takeover' }, Takeover)

      // Drifted chain component: demands a matched shape the selector cannot
      // supply (NoInfer pins M to the select return — the component position
      // must not widen it).
      // @ts-expect-error component matched prop drifts from the select return
      core.register({
        name: 'chain.takeover',
        select: ({ items }: { items: readonly Item[] }) => items.find(i => i.kind === 'q') ?? null,
      }, NarrowTakeover)

      // select must return M | null, not undefined (find() must be coalesced).
      // @ts-expect-error select may not return undefined
      core.register({
        name: 'chain.takeover',
        select: ({ items }: { items: readonly Item[] }) => items.find(i => i.kind === 'q'),
      }, Takeover)

      // Chain keys are not renderSlot-dispatchable (and vice versa).
      // @ts-expect-error chain keys dispatch through renderSlotChain only
      chainSlots.renderSlot('chain.takeover', { items: [] })
      // @ts-expect-error non-chain keys have no renderSlotChain dispatch
      chainSlots.renderSlotChain('chain.conv', {})
      // @ts-expect-error a children set without chain keys provides no renderSlotChain
      type _NoChainSeat = typeof fp.renderSlotChain

      // renderSlot owner share typed at the call site.
      // @ts-expect-error owner shape mismatch (width missing)
      fp.renderSlot('chain.side', { collapsed: false })
      // @ts-expect-error key not in this render share
      fp.renderSlot('chain.tools', {})

      // Contextual hooks preserve both the business key and value type.
      // @ts-expect-error unknown Turn-data key
      contextProps.useTurnData('other')
      // @ts-expect-error a contextual slot requires its occurrence context
      contextSlots.renderSlot('chain.context', {})
      // @ts-expect-error hookContext is the slot-declared string
      const _wrongContextFactory: SlotHookFactory<'chain.context', UseTurnData> =
        (_standard, _hookContext: number) => () => undefined
      void _wrongContextFactory

      // baked actions strip the draft parameter.
      acts.setDraft('x')
      // @ts-expect-error wrong payload type
      acts.setDraft(1)

      // SessionProvider seat: derives from a session-scope child declaration.
      fp.SessionProvider({ empty: () => null, children: () => null })
      const sideOnly: PropsRenderSlots<'chain.side'> = null as never
      // @ts-expect-error only root-scope children declared → no SessionProvider seat
      void sideOnly.SessionProvider
    }
    expect(samples).toBeTypeOf('function')
  })
})
