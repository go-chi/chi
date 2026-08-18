/** State owner for the optional local settings-document action. */

import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** Browser state of the Host-owned settings document. */
export interface SettingsDocumentState {
  /** Metadata-loading phase; unavailable means the provider has no local document or the read failed. */
  status: 'idle' | 'loading' | 'ready' | 'unavailable'
  /** Whether one native-open request is in flight. */
  opening: boolean
  /** Last metadata/native-open diagnostic; UI exposes only localized copy. */
  error: string | null
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Loads local-document availability and invokes the pathless Host-owned open operation. */
export class SettingsDocumentStore {
  /** uSES-safe state source shared by the registered header action. */
  readonly store: SnapshotStore<SettingsDocumentState> = createSnapshotStore({
    status: 'idle', opening: false, error: null,
  })

  private generation = 0

  /**
   * @param api - loopback settings wire face that reports and opens the provider document.
   */
  constructor(private readonly api: Pick<IApiClient, 'settings'>) {}

  /**
   * Load whether the current provider owns a local document.
   * @returns after the latest metadata response updates the store.
   */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((state) => {
      state.status = 'loading'
      state.error = null
    })
    try {
      const { result } = await this.api.settings.describe({})
      if (generation !== this.generation) return
      if (!result.ok) {
        this.store.update((state) => {
          state.status = 'unavailable'
          state.error = result.error.message
        })
        return
      }
      this.store.update((state) => {
        state.status = result.value.hasDocument ? 'ready' : 'unavailable'
        state.error = null
      })
    } catch (error) {
      if (generation !== this.generation) return
      this.store.update((state) => {
        state.status = 'unavailable'
        state.error = messageOf(error)
      })
    }
  }

  /**
   * Open the loaded document once; concurrent gestures collapse behind the in-flight action.
   * @returns after the native-open request settles, or immediately when unavailable/already opening.
   */
  async open(): Promise<void> {
    const current = this.store.getSnapshot()
    if (current.status !== 'ready' || current.opening) return
    this.store.update((state) => {
      state.opening = true
      state.error = null
    })
    try {
      const response = await this.api.settings.openDocument({})
      if (!response.result.ok) throw new Error(response.result.error.message)
    } catch (error) {
      this.store.update((state) => { state.error = messageOf(error) })
    } finally {
      this.store.update((state) => { state.opening = false })
    }
  }
}

/**
 * Refresh document availability after reconnect only when a surface has already requested it.
 * @param controller - optional loopback document state owner.
 */
export function refreshDocumentIfLoaded(controller: SettingsDocumentStore | undefined): void {
  if (controller === undefined || controller.store.getSnapshot().status === 'idle') return
  void controller.load()
}
