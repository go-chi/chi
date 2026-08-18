/**
 * App-shell assembly plugin. Its pseudo package id exists only in the host
 * graph and shell registry; there is no npm package behind it.
 */
import type { ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { createSlotRenderer } from '@deepseek-ai/dsh-client-web-react'
import { buildRenderApp } from './app.tsx'

/** Shell-owned pseudo entry id under which the host graph mounts this plugin. */
export const APP_SHELL_ID = '@deepseek-ai/dsh-client-app-shell'

/** The assembled-UI face AppRoot renders once the boot settles. */
export interface AppShellService {
  /** Build (once) and render the real UI tree. */
  renderApp: () => ReactNode
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The shell assembly face, provided by the app-shell entry once its inject set is active. */
    appShell: AppShellService
  }
}

/** Cordis plugin name. */
export const name = 'app-shell'

/** Services required before shell assembly. */
export const inject = ['slots', 'sessions', 'layout']

/** Installs the React renderer and exposes the assembled application.
 * @param ctx - Plugin context.
 */
export function apply(ctx: Context): void {
  // The renderer install is shell territory (web-react is shell-bundled),
  // but ctx.slots exists only once the runtime entry is active — so it lands
  // here, on the entry whose inject set guarantees that ordering.
  ctx.slots.install(createSlotRenderer())

  // Assemble once on first render: the closure must be identity-stable
  // across AppRoot re-renders.
  let renderApp: (() => ReactNode) | undefined
  ctx.reflect.provide('appShell', {
    renderApp: (): ReactNode => {
      renderApp ??= buildRenderApp({ ctx })
      return renderApp()
    },
  })
}
