/**
 * Web shell library entry. The shell's product is {@link AppWebEntry} —
 * apps/web's vite entry runs it against #root; everything else (AppRoot
 * gate, app-shell assembly entry, module-table staticModules, platform constants) is
 * internal to the boot chain. PLATFORM_MODULES is re-exported as the
 * single source of truth for the tsdown client externals projection.
 * @module @deepseek-ai/dsh-client-web
 */

export { AppWebEntry, type BootSeams } from './boot.tsx'
export { AppRoot, type AppRootProps } from './AppRoot.tsx'
export { buildRenderApp, type AssemblyDeps } from './app.tsx'
export { DocumentTitle, type DocumentTitleProps } from './DocumentTitle.tsx'
export { APP_SHELL_ID, type AppShellService } from './app-shell.ts'
export { getStaticModules } from './seed.ts'
export { PLATFORM_MODULES, type PlatformModule } from './platform.ts'
export {
  STATE_LABELS, FIBER_STATE, createSignal, createLoaderStatusStore,
  type LoaderStatus, type LoaderEntryState, type KernelSignal, type KernelValueSignal, type LoaderStatusStore,
} from './loader-status.ts'
