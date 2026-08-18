/**
 * Menu reduction pure core. One group per source;
 * generation-gated settlement; empty ready groups auto-close. Zero React /
 * DOM / cordis. Stale or no-op events return the same state reference so
 * store subscribers skip re-renders.
 *
 * Roster protocol: the frozen `hit` event carries no source roster, so the
 * reducer cannot invent groups. Opening from a closed state, the shell seeds
 * the roster with {@link seedGroups} and then dispatches `hit`; a `hit`
 * while open (query refinement) resets the existing groups to pending under
 * a new generation. Auto-close and explicit close drop the groups.
 */
import type { InputTriggerCandidate } from '../types.ts'
import type { ExactMatch, MenuReduce, MenuState } from './contract.ts'

/** Closed rest state with generation 0; store initializer and test seed. */
export const MENU_CLOSED: MenuState = { open: false, hit: null, generation: 0, groups: [], highlight: null }

/**
 * Replace the group roster with pending groups for `sources`, in order.
 * Shell-side step before dispatching `hit` on a fresh menu open.
 *
 * @param state - Current menu state.
 * @param sources - Source names registered for the hit trigger, menu order.
 * @returns State carrying the new pending roster; highlight cleared.
 */
export function seedGroups(state: MenuState, sources: readonly string[]): MenuState {
  return { ...state, groups: sources.map(source => ({ source, status: 'pending', items: [] })), highlight: null }
}

/** Close, preserving the generation so in-flight settlements stay droppable. */
const closed = (state: MenuState): MenuState =>
  state.open || state.hit !== null || state.groups.length > 0 || state.highlight !== null
    ? { open: false, hit: null, generation: state.generation, groups: [], highlight: null }
    : state

/** First item of the first non-empty ready group, or null. */
function firstHighlight(groups: MenuState['groups']): MenuState['highlight'] {
  for (const g of groups) {
    if (g.status === 'ready' && g.items.length > 0) return { source: g.source, index: 0 }
  }
  return null
}

/** The highlight itself when it still points at a ready item, else null. */
function validHighlight(highlight: MenuState['highlight'], groups: MenuState['groups']): MenuState['highlight'] {
  if (!highlight) return null
  const g = groups.find(x => x.source === highlight.source)
  return g && g.status === 'ready' && highlight.index < g.items.length ? highlight : null
}

/** Flatten ready items into (source, index) positions in group order. */
function positions(groups: MenuState['groups']): { source: string; index: number }[] {
  const out: { source: string; index: number }[] = []
  for (const g of groups) {
    if (g.status !== 'ready') continue
    for (let i = 0; i < g.items.length; i++) out.push({ source: g.source, index: i })
  }
  return out
}

/** True when every group is ready with zero items (the auto-close condition). */
const allReadyEmpty = (groups: MenuState['groups']): boolean =>
  groups.every(g => g.status === 'ready' && g.items.length === 0)

/**
 * Pure menu reducer. `hit` opens a new generation over the seeded roster
 * (null hit closes); `source-settled` outside the current generation, the
 * open menu, or the roster is dropped; a settlement or failure leaving every
 * group ready-and-empty (or no groups) auto-closes; `source-failed` silently
 * removes the group (the shell logs); `move` cycles the highlight across
 * ready items.
 *
 * @param state - Current menu state.
 * @param ev - Menu event.
 * @returns Next state; the same reference when stale or a no-op.
 */
export const menuReduce: MenuReduce = (state, ev) => {
  switch (ev.type) {
    case 'hit': {
      if (ev.hit === null) return closed(state)
      return {
        open: true,
        hit: ev.hit,
        generation: state.generation + 1,
        groups: state.groups.map(g => ({ source: g.source, status: 'pending', items: [] })),
        highlight: null,
      }
    }
    case 'source-settled': {
      if (!state.open || ev.generation !== state.generation) return state
      const idx = state.groups.findIndex(g => g.source === ev.source)
      if (idx < 0) return state
      const items: readonly InputTriggerCandidate[] = ev.items ?? []
      const groups = state.groups.map((g, i) =>
        i === idx ? { source: g.source, status: 'ready' as const, items } : g)
      if (allReadyEmpty(groups)) return closed(state)
      const highlight = validHighlight(state.highlight, groups) ?? firstHighlight(groups)
      return { ...state, groups, highlight }
    }
    case 'source-failed': {
      if (!state.open || ev.generation !== state.generation) return state
      if (!state.groups.some(g => g.source === ev.source)) return state
      const groups = state.groups.filter(g => g.source !== ev.source)
      if (groups.length === 0 || allReadyEmpty(groups)) return closed(state)
      const highlight = validHighlight(state.highlight, groups) ?? firstHighlight(groups)
      return { ...state, groups, highlight }
    }
    case 'move': {
      if (!state.open) return state
      const pos = positions(state.groups)
      if (pos.length === 0) return state
      const hl = state.highlight
      const at = hl ? pos.findIndex(p => p.source === hl.source && p.index === hl.index) : -1
      const next = pos[at < 0
        ? (ev.dir === 1 ? 0 : pos.length - 1)
        : (at + ev.dir + pos.length) % pos.length]
      if (next === undefined) return state
      if (hl && next.source === hl.source && next.index === hl.index) return state
      return { ...state, highlight: next }
    }
    case 'close':
      return closed(state)
  }
}

/**
 * Exact-name lookup in one source's ready group.
 *
 * @param groups - Menu groups.
 * @param source - Source (group) name.
 * @param name - Candidate name to match exactly.
 * @returns The candidate, or null when the group is absent, not ready, or
 * has no candidate of that name.
 */
export const exactMatch: ExactMatch = (groups, source, name) => {
  const group = groups.find(g => g.source === source)
  if (!group || group.status !== 'ready') return null
  return group.items.find(c => c.name === name) ?? null
}
