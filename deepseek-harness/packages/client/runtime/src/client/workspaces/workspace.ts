/** React-free Workspace entity with a client-local materialization lifecycle. */

import type {
  IApiClient, RpcResult, WorkspaceView,
} from '@deepseek-ai/dsh-api-remotes/client'
import { transportError } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { ObservableSnapshot } from '../contract/store.ts'
import { Notifier } from '../sessions/notifier.ts'

/** Host input retained by a local Workspace until materialization succeeds. */
export type WorkspaceCreateInput = { path: string }

/** Observable state of a client-local Workspace intent. */
export interface WorkspaceIntentSnapshot {
  name: string
  phase: 'ready' | 'creating'
  error?: string
}

/** A Workspace is either a local intent or a materialized Host view. */
export interface WorkspaceSnapshot {
  view: WorkspaceView | undefined
  intent: WorkspaceIntentSnapshot | undefined
}

interface WorkspaceIntent {
  input: WorkspaceCreateInput
  snapshot: WorkspaceIntentSnapshot
}

/**
 * Observable Workspace object whose identity survives Host materialization.
 * Local instances retain their create input and failure state; materialized
 * instances expose the latest Host view.
 */
export class Workspace implements ObservableSnapshot<WorkspaceSnapshot> {
  private view: WorkspaceView | undefined
  private intent: WorkspaceIntent | undefined
  private materialization: Promise<RpcResult<{ workspace: WorkspaceView; created: boolean }>> | null = null
  private snapshotCache: WorkspaceSnapshot
  private readonly notifier = new Notifier(() => {
    this.snapshotCache = this.buildSnapshot()
  })

  /**
   * @param api - shared wire client.
   * @param source - local create input or an existing Host Workspace view.
   */
  constructor(private readonly api: IApiClient, source: WorkspaceCreateInput | WorkspaceView) {
    if ('workspaceId' in source) {
      this.view = source
    } else {
      this.intent = {
        input: source,
        snapshot: { name: intentName(source), phase: 'ready' },
      }
    }
    this.snapshotCache = this.buildSnapshot()
  }

  /**
   * Materialize this local Workspace through the Host create API.
   * Re-entry shares the in-flight completion; a materialized instance returns undefined.
   * @returns the Host result, or undefined when this Workspace is already materialized.
   */
  materialize(): Promise<RpcResult<{ workspace: WorkspaceView; created: boolean }>> | undefined {
    if (this.materialization !== null) return this.materialization
    const intent = this.intent
    if (intent === undefined) return undefined
    intent.snapshot = { name: intent.snapshot.name, phase: 'creating' }
    this.notifier.notifyNow()
    const completion = this.completeMaterialization(intent).finally(() => {
      if (this.materialization === completion) this.materialization = null
    })
    this.materialization = completion
    return completion
  }

  /**
   * Adopt a Host view without replacing this Workspace object.
   * An existing materialized identity accepts updates only for the same Workspace id.
   * @param view - latest Host projection.
   */
  adopt(view: WorkspaceView): void {
    if (this.view !== undefined && this.view.workspaceId !== view.workspaceId) {
      throw new Error('cannot adopt a different Workspace id')
    }
    this.view = view
    this.intent = undefined
    this.notifier.markDirty()
  }

  /**
   * Subscribe to Workspace snapshot invalidation.
   * @param listener - snapshot invalidation callback.
   * @returns unsubscribe function.
   */
  subscribe(listener: () => void): () => void {
    return this.notifier.subscribe(listener)
  }

  /**
   * Read the cached Workspace snapshot after flushing pending notifications.
   * @returns the cached Workspace snapshot.
   */
  getSnapshot(): WorkspaceSnapshot {
    this.notifier.ensureFresh()
    return this.snapshotCache
  }

  private async completeMaterialization(
    intent: WorkspaceIntent,
  ): Promise<RpcResult<{ workspace: WorkspaceView; created: boolean }>> {
    let result: RpcResult<{ workspace: WorkspaceView; created: boolean }>
    try {
      result = (await this.api.workspace.create(intent.input)).result
    } catch (error) {
      result = transportError(error)
    }
    if (this.intent !== intent) return result
    if (result.ok) {
      this.adopt(result.value.workspace)
    } else {
      intent.snapshot = {
        name: intent.snapshot.name,
        phase: 'ready',
        error: `${result.error.code}: ${result.error.message}`,
      }
      this.notifier.markDirty()
    }
    return result
  }

  private buildSnapshot(): WorkspaceSnapshot {
    return { view: this.view, intent: this.intent?.snapshot }
  }
}

function intentName(input: WorkspaceCreateInput): string {
  const trimmed = input.path.replace(/[\\/]+$/, '')
  return trimmed.split(/[\\/]/).pop() ?? input.path
}
