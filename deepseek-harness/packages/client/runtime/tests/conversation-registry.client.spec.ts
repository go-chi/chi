import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { ConversationEventRegistry } from '../src/client/conversation/event-registry.ts'
import { ConversationViewRegistry } from '../src/client/conversation/view-registry.ts'
import type {
  ConversationNodeDefinition, ConversationViewDefinition, ConversationViewNode,
} from '../src/client/contract/conversation.ts'
import { Session } from '../src/client/sessions/session.ts'
import { SessionRuntime } from '../src/client/sessions/service.ts'
import { FakeApiClient, fakeRemote, ok } from './fake-api.client.ts'

function eventDefinition(kind: string): ConversationNodeDefinition<null> {
  return {
    kind,
    target: 'chat',
    match: () => null,
    start: () => null,
    update: context => context.state,
    buildViewNode: () => null,
  }
}

function viewDefinition(target: string): ConversationViewDefinition<ConversationViewNode, null> {
  return {
    target,
    create: () => ({
      empty: null,
      replace: () => null,
      apply: () => null,
    }),
  }
}

async function bootRegistries(): Promise<{
  ctx: Context
  events: ConversationEventRegistry
  views: ConversationViewRegistry
}> {
  const ctx = new Context()
  await ctx.plugin(ConversationEventRegistry).await()
  await ctx.plugin(ConversationViewRegistry).await()
  const events = ctx.get('conversationEvents') as ConversationEventRegistry
  const views = ctx.get('conversationViews') as ConversationViewRegistry
  return { ctx, events, views }
}

describe('Conversation registries', () => {
  it('rejects duplicate Event Definitions and disposes an ordinary registration once', async () => {
    const { events } = await bootRegistries()
    const definition = eventDefinition('message')
    const dispose = events.register(definition)

    expect(events.entries()).toEqual([definition])
    expect(() => events.register(eventDefinition('message'))).toThrow(/already registered/)

    dispose()
    dispose()
    expect(events.entries()).toEqual([])
  })

  it('rejects a duplicate fallback and clears it through its idempotent disposer', async () => {
    const { events } = await bootRegistries()
    const fallback = eventDefinition('unknown')
    const dispose = events.registerFallback(fallback)

    expect(events.fallbackEntry()).toBe(fallback)
    expect(() => events.registerFallback(eventDefinition('other'))).toThrow(/already registered/)

    dispose()
    dispose()
    expect(events.fallbackEntry()).toBeUndefined()
  })

  it('rejects rendering Definitions that omit either target or builder', async () => {
    const { events } = await bootRegistries()
    const targetOnly: ConversationNodeDefinition<null> = {
      kind: 'target-only',
      target: 'chat',
      match: () => null,
      start: () => null,
      update: context => context.state,
    }
    const builderOnly: ConversationNodeDefinition<null> = {
      kind: 'builder-only',
      match: () => null,
      start: () => null,
      update: context => context.state,
      buildViewNode: () => null,
    }

    expect(() => events.register(targetOnly)).toThrow(/target and buildViewNode together/)
    expect(() => events.register(builderOnly)).toThrow(/target and buildViewNode together/)
  })

  it('rejects a State-only Definition as the unmatched-event fallback', async () => {
    const { events } = await bootRegistries()
    const fallback: ConversationNodeDefinition<null> = {
      kind: 'state-only-fallback',
      match: () => null,
      start: () => null,
      update: context => context.state,
    }

    expect(() => events.registerFallback(fallback))
      .toThrow('conversation fallback Definition must declare a target')
  })

  it('rejects duplicate view targets and disposes a view registration once', async () => {
    const { views } = await bootRegistries()
    const definition = viewDefinition('chat')
    const dispose = views.register(definition)

    expect(views.entries()).toEqual([definition])
    expect(() => views.register(viewDefinition('chat'))).toThrow(/already registered/)

    dispose()
    dispose()
    expect(views.entries()).toEqual([])
  })

  it('removes Event, fallback, and view contributions with their caller fiber', async () => {
    const { ctx, events, views } = await bootRegistries()
    const feature = ctx.inject(['conversationEvents', 'conversationViews'], (featureCtx) => {
      featureCtx.conversationEvents.register(eventDefinition('message'))
      featureCtx.conversationEvents.registerFallback(eventDefinition('unknown'))
      featureCtx.conversationViews.register(viewDefinition('chat'))
    })
    await feature.await()

    expect(events.entries()).toHaveLength(1)
    expect(events.fallbackEntry()).toBeDefined()
    expect(views.entries()).toHaveLength(1)

    await feature.dispose()
    expect(events.entries()).toEqual([])
    expect(events.fallbackEntry()).toBeUndefined()
    expect(views.entries()).toEqual([])
  })

  it('coalesces registry changes into one rebuild of every resident Session', async () => {
    const { ctx, events, views } = await bootRegistries()
    const api = new FakeApiClient()
    const sessionId = 'resident' as SessionId
    api.onList = () => Promise.resolve(ok({
      items: [{ sessionId, updatedAt: 1, running: false, blank: true }],
    }) as never)
    const sessions = new SessionRuntime(ctx, api, fakeRemote())
    await sessions.refresh()
    await Promise.resolve()
    sessions.scope(sessionId)
    const rebuild = vi.spyOn(Session.prototype, 'rebuildConversationRegistry')

    events.register(eventDefinition('message'))
    views.register(viewDefinition('chat'))
    await Promise.resolve()

    expect(rebuild).toHaveBeenCalledOnce()
    rebuild.mockRestore()
  })
})
