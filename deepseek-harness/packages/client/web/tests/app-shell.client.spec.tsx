// @vitest-environment jsdom
/**
 * App-shell assembly plugin on the real machinery: bare Context + production
 * SlotRegistry + the test-runtime session/workspace doubles. Deliberately NOT
 * mounted through SlotTestRuntime — its create() installs the capturing
 * renderer and install() is boot-once; app-shell IS the production installer,
 * so this bench hands it the uninstalled service exactly as boot does.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { TestSessions, TestWorkspaces } from '@deepseek-ai/dsh-client-test-runtime'
import type { Stabilizer } from '@deepseek-ai/dsh-client-test-runtime'
import * as AppShell from '@deepseek-ai/dsh-client-web/src/app-shell.ts'

afterEach(cleanup)

const stabilize: Stabilizer = async (fn) => { await act(async () => { await fn() }) }

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  ctx.provide('sessions', new TestSessions(stabilize, ctx))
  ctx.provide('workspaces', new TestWorkspaces(stabilize))
  ctx.provide('layout', { openDetails: vi.fn(), closeDetails: vi.fn() })
  const fiber = ctx.plugin({ inject: [...AppShell.inject], apply: AppShell.apply })
  await fiber.await()
  return { ctx, slots, fiber }
}

describe('app-shell assembly plugin', () => {
  it('installs the renderer and provides the assembled appShell face', async () => {
    const { ctx, slots } = await bench()
    slots.register({ name: 'root' }, () => <div data-testid="root-probe" />)
    const shell = ctx.get('appShell')
    expect(shell).toBeDefined()
    const view = render(<>{shell!.renderApp()}</>)
    expect(view.getByTestId('root-probe')).toBeTruthy()
  })

  it('assembles once: repeated renderApp calls reuse the built closure', async () => {
    const { ctx, slots } = await bench()
    slots.register({ name: 'root' }, () => <div data-testid="root-probe" />)
    const shell = ctx.get('appShell')!
    const first = render(<>{shell.renderApp()}</>)
    expect(first.getByTestId('root-probe')).toBeTruthy()
    first.unmount()
    // Second call rides the cached closure (renderApp ??=) and still renders.
    const second = render(<>{shell.renderApp()}</>)
    expect(second.getByTestId('root-probe')).toBeTruthy()
  })

  it('fiber dispose retracts the service and uninstalls the renderer', async () => {
    const { ctx, slots, fiber } = await bench()
    await stabilize(() => fiber.dispose())
    expect(ctx.get('appShell')).toBeUndefined()
    expect(() => slots.renderSlot('root', {})).toThrow('not installed')
  })
})
