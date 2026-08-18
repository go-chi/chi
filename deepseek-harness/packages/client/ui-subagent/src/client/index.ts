/**
 * Subagent reference plugin, browser half: registers the '@' source —
 * candidates filtered from the session list snapshot's running children
 * (zero RPC; the list rides the plugin's root-context sessions service, the
 * scoped session comes from the per-call projection), pick inserts the
 * literal `@label ` text (plain-text-reference decision, see
 * .agents/notes/implemented/architecture/2026-07-25-web-input-machine-and-slash-pipeline.md:
 * the draft carries plain text, chip
 * visuals are derived by scanning against the source lexicon, and the
 * prompt ships the same literal). Consumption semantics stay with future
 * business work. No adjudication hooks: subagent
 * references never enter command adjudication.
 */
import type {
  ClientContext, SessionId, SubagentAddress,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ComposerChainProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ClientSessionContext, InputTriggerServiceContract, InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { SubagentCatalogAction, type SubagentCatalogInjected } from './SubagentCatalogAction.tsx'
import {
  SubagentReadOnlyComposer, type SubagentReadOnlyMatch,
} from './SubagentReadOnlyComposer.tsx'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { en, NS, zh, type SubagentKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Subagent catalog and read-only composer copy. */
    'subagent': SubagentKey
  }
}

export type {
  SubagentCatalogActionProps, SubagentCatalogInjected,
} from './SubagentCatalogAction.tsx'
export type {
  SubagentReadOnlyComposerProps, SubagentReadOnlyMatch,
} from './SubagentReadOnlyComposer.tsx'

/** Required services for references, conversation slots, and session navigation. */
export const inject = ['inputTriggers', 'sessions', 'slots', 'locale']

/** Claim the composer for one-shot history or an unavailable continuation owner. */
function selectReadOnlySubagent(owner: ComposerChainProps): SubagentReadOnlyMatch | null {
  const subagent = owner.session?.subagent
  if (subagent === undefined || subagent === null) return null
  if (subagent.address.mode === 'one-shot') return { reason: 'one-shot' }
  if (subagent.parentAvailable) return null
  // A RUNNING parent-offline continuable child keeps the default composer:
  // its input is disabled there, but the same primary Stop stays available so
  // the child can be interrupted. Once it stops, this takeover returns.
  return owner.session?.running === true ? null : { reason: 'parent-unavailable' }
}

/**
 * Client plugin body: register the '@' subagent source over the root session list.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-subagent: dictionaries')
  const sessions = ctx.sessions
  // Child labels live on the session list (parentId lineage + displayTitle),
  // not the conversation snapshot — the list store is the zero-RPC candidate feed.
  const childLabels = (session: ClientSessionContext, query: string): string[] => {
    const { byId } = sessions.list.getSnapshot()
    return Object.values(byId)
      .filter(child => child.parentId === session.sessionId && child.running && child.displayTitle.includes(query))
      .map(child => child.displayTitle)
  }
  const source: InputTriggerSource = {
    trigger: '@',
    name: 'subagent',
    candidates(session, { query }) {
      return Promise.resolve(childLabels(session, query).map(name => ({ name })))
    },
    lexicon(session) {
      // The list snapshot is always warm — the full running-children roster.
      return childLabels(session, '')
    },
    subscribeLexicon(_session, listener) {
      // The roll derives from the list snapshot, so its change feed IS the list's.
      return sessions.list.subscribe(listener)
    },
    onPick({ candidate }) {
      // Plain-text reference: the literal lands in the draft
      // and ships to the model verbatim (trailing space closes the token).
      return { text: `@${candidate.name} ` }
    },
    codec: {
      clipboardText: ref => `@${ref}`,
      // TODO: serialize returns the raw label until the '@' consumption
      // feature defines a model representation.
      serialize: ref => Promise.resolve(`@${ref}`),
    },
  }
  const inputTriggers = ctx.get('inputTriggers') as InputTriggerServiceContract
  ctx.effect(() => inputTriggers.registerSource(source), 'ui-subagent: @ source')

  const catalogActions = (_parentSessionId: SessionId): SubagentCatalogInjected => ({
    openChild(address: SubagentAddress) {
      sessions.openSubagent(address)
    },
    refresh(parentSessionId: SessionId) {
      void sessions.refreshSubagents(parentSessionId)
    },
    setCatalogOpen(parentSessionId: SessionId, open: boolean) {
      sessions.setSubagentCatalogOpen(parentSessionId, open)
    },
  })
  ctx.slots.inject(
    'conversation.session.header.actions',
    () => ctx.slots.register({
      name: 'conversation.session.header.actions',
      id: 'subagent-catalog',
      order: 10,
      locale: NS,
      inject: catalogActions,
    }, SubagentCatalogAction),
  )
  ctx.slots.inject(
    'conversation.composer',
    () => ctx.slots.register({
      name: 'conversation.composer',
      priority: -10,
      locale: NS,
      select: selectReadOnlySubagent,
    }, SubagentReadOnlyComposer),
  )
}
