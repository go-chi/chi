/** Workspace baseline, incremental-frame, and unary-action owner. */

import type {
  HostFrame, IApiClient, RpcError, RpcRequest, RpcResult, SessionId, WorkspaceId, WorkspaceView,
} from '@deepseek-ai/dsh-api-remotes/client'
import { transportError } from '@deepseek-ai/dsh-host-apiproxy/api'
import { Notifier } from '../sessions/notifier.ts'
import { Workspace, type WorkspaceCreateInput } from './workspace.ts'

/** Monotone workspace-list arrival lifecycle. */
export type WorkspaceListPhase = 'pending' | 'ready'

/** Immutable workspace-list snapshot. */
export interface WorkspaceListSnapshot {
  items: readonly WorkspaceView[]
  /**
   * Registry-global archive set in Host order (hidden from grouping
   * surfaces; accounting slots retained). A plain array, not a Set: public
   * snapshot state stays in the store engine's plain-data vocabulary
   * (immer drafts reject Sets without the MapSet plugin); membership
   * lookups build their own transient Set where they need one.
   */
  archivedSessionIds: readonly SessionId[]
  state: 'idle' | 'loading' | 'error'
  phase: WorkspaceListPhase
  error: RpcError | null
}

type WorkspaceDelta =
  | { type: 'upsert'; workspace: WorkspaceView }
  | { type: 'remove'; workspaceId: WorkspaceId }
  | { type: 'order'; workspaceIds: readonly WorkspaceId[] }

/** Workspace object cluster driven by one list baseline and changed-frame upserts. */
export class WorkspaceManager {
  private items: Workspace[] = []
  private itemViewsSource: readonly Workspace[] | null = null
  private itemViewsCache: readonly WorkspaceView[] = []
  // Full-snapshot state (list response / unary response / changed frame all
  // carry the complete set), so deltas never merge — installs replace.
  private archivedSessionIds: readonly SessionId[] = []
  private state: WorkspaceListSnapshot['state'] = 'idle'
  private phase: WorkspaceListPhase = 'pending'
  private error: RpcError | null = null
  private inflight: Promise<void> | null = null
  private refreshFrames: WorkspaceDelta[] | null = null
  /**
   * True once a frame or unary echo installed the archive set while a list
   * request was in flight: that install is newer than the pending baseline,
   * so the baseline's (older) set must not roll it back — the archive
   * mirror of replaying refreshFrames over the item baseline.
   */
  private archivedSupersedesRefresh = false
  /** Latest local reorder request; only its unary echo may install order. */
  private orderRequestGeneration = 0
  /** Increments on order frames so a later remote commit outranks an older unary echo. */
  private orderFrameGeneration = 0
  /** Last complete order accepted from a Host baseline, frame, or current unary echo. */
  private committedOrder: WorkspaceId[] = []
  /**
   * Ids this process has seen removed, kept for the connection's lifetime so
   * a late changed frame or a stale baseline row cannot resurrect a deleted
   * row. Correctness rests on Host ids never being reused (the registry mints
   * a fresh `randomUUID` per record, including when the same directory is
   * registered again) — a path-derived id scheme would turn these entries
   * into permanent blindfolds and must clear them instead.
   */
  private readonly removedIds = new Set<WorkspaceId>()
  private snapshotCache: WorkspaceListSnapshot
  private readonly notifier = new Notifier(() => {
    this.snapshotCache = this.buildSnapshot()
  })

  /** @param api - shared wire client. */
  constructor(private readonly api: IApiClient) {
    this.snapshotCache = this.buildSnapshot()
  }

  /**
   * Refresh from workspace.list. The first successful response establishes
   * Host order; later responses re-establish the durable order so reconnects
   * adopt reorders committed while this client was offline. Frames arriving
   * during the RPC are replayed over its response.
   * @returns the shared in-flight refresh.
   */
  refresh(): Promise<void> {
    if (this.inflight !== null) return this.inflight
    this.state = 'loading'
    this.error = null
    const frames: WorkspaceDelta[] = []
    this.refreshFrames = frames
    this.notifier.markDirty()
    this.inflight = (async () => {
      try {
        const { result } = await this.api.workspace.list({})
        if (result.ok) {
          let items = result.value.items
          items = items.filter(workspace => !this.removedIds.has(workspace.workspaceId))
          for (const delta of frames) items = applyWorkspaceDelta(items, delta)
          this.installViews(items)
          if (!this.archivedSupersedesRefresh) this.installArchived(result.value.archivedSessionIds)
          this.state = 'idle'
          this.phase = 'ready'
        } else {
          this.state = 'error'
          this.error = result.error
        }
      } catch (error) {
        this.state = 'error'
        const folded = transportError<never>(error)
        /* v8 ignore next -- transportError always returns the failure branch. */
        this.error = folded.ok ? null : folded.error
      } finally {
        this.refreshFrames = null
        this.archivedSupersedesRefresh = false
        this.inflight = null
        this.notifier.markDirty()
      }
    })()
    return this.inflight
  }

  /**
   * Create or resolve a real Workspace, then publish its returned snapshot
   * without waiting for the changed frame.
   * @param input - the existing absolute path to adopt.
   * @returns the wire result.
   */
  async create(input: WorkspaceCreateInput): Promise<RpcResult<{ workspace: WorkspaceView; created: boolean }>> {
    const workspace = new Workspace(this.api, input)
    const completion = workspace.materialize()
    if (completion === undefined) throw new Error('a local Workspace must be materializable')
    const result = await completion
    if (result.ok) this.upsert(result.value.workspace, workspace)
    return result
  }

  /**
   * Rename a Workspace, then publish its returned snapshot without waiting
   * for the changed frame.
   * @param workspaceId - target workspace.
   * @param title - new display title.
   * @returns the wire result.
   */
  async rename(workspaceId: WorkspaceId, title: string): Promise<RpcResult<{ workspace: WorkspaceView }>> {
    const { result } = await this.api.workspace.rename({ workspaceId, title })
    if (result.ok) this.upsert(result.value.workspace)
    return result
  }

  /**
   * Delete a Workspace registration and remove its local projection from the
   * unary response without waiting for the Host frame.
   * @param workspaceId - target workspace.
   * @returns the wire result.
   */
  async delete(workspaceId: WorkspaceId): Promise<RpcResult<{ deleted: true }>> {
    const { result } = await this.api.workspace.delete({ workspaceId })
    if (result.ok) this.remove(workspaceId, true)
    return result
  }

  /**
   * Move a Workspace within the registry display order and install the full
   * returned order without waiting for the Host frame.
   * @param workspaceId - Workspace to move.
   * @param beforeWorkspaceId - Anchor workspace; omitted appends.
   * @returns the wire result.
   */
  async insertBefore(
    workspaceId: WorkspaceId,
    beforeWorkspaceId?: WorkspaceId,
  ): Promise<RpcResult<{ workspaceIds: WorkspaceId[] }>> {
    const requestGeneration = ++this.orderRequestGeneration
    const frameGeneration = this.orderFrameGeneration
    const localOrder = this.itemViews().map(workspace => workspace.workspaceId)
    this.installOrder(insertIdBefore(localOrder, workspaceId, beforeWorkspaceId))
    let result: RpcResult<{ workspaceIds: WorkspaceId[] }>
    try {
      ;({ result } = await this.api.workspace.insertBefore({
        workspaceId,
        ...beforeWorkspaceId === undefined ? {} : { beforeWorkspaceId },
      }))
    } catch (error) {
      if (requestGeneration === this.orderRequestGeneration
        && frameGeneration === this.orderFrameGeneration) {
        this.installOrder(this.committedOrder)
      }
      throw error
    }
    if (result.ok && requestGeneration === this.orderRequestGeneration
      && frameGeneration === this.orderFrameGeneration) {
      this.installOrder(result.value.workspaceIds, true)
    } else if (!result.ok && requestGeneration === this.orderRequestGeneration
      && frameGeneration === this.orderFrameGeneration) {
      this.installOrder(this.committedOrder)
    }
    return result
  }

  /**
   * Move a session within its Workspace's manual order, then publish the
   * returned snapshot without waiting for the changed frame.
   * @param workspaceId - owning workspace.
   * @param sessionId - accounted session to move.
   * @param beforeSessionId - accounted anchor to insert before; omitted appends.
   * @returns the wire result.
   */
  async insertSessionBefore(
    workspaceId: WorkspaceId,
    sessionId: SessionId,
    beforeSessionId?: SessionId,
  ): Promise<RpcResult<{ workspace: WorkspaceView }>> {
    const { result } = await this.api.workspace.insertSessionBefore({
      workspaceId, sessionId,
      ...beforeSessionId === undefined ? {} : { beforeSessionId },
    })
    if (result.ok) this.upsert(result.value.workspace)
    return result
  }

  /**
   * Archive one session in the registry-global set, then install the
   * returned full set without waiting for the changed frame.
   * @param sessionId - session to archive.
   * @returns the wire result.
   */
  async archiveSession(sessionId: SessionId): Promise<RpcResult<{ archivedSessionIds: SessionId[] }>> {
    const { result } = await this.api.workspace.archiveSession({ sessionId })
    if (result.ok) this.installArchived(result.value.archivedSessionIds)
    return result
  }

  /**
   * Host-frame entry. Non-workspace frames are ignored so the runtime can
   * fan one host stream out to both object managers.
   * @param envelope - host stream envelope.
   */
  handleHostEnvelope(envelope: RpcRequest<HostFrame>): void {
    if (envelope.payload.type === 'host/workspace-changed') this.upsert(envelope.payload.workspace)
    else if (envelope.payload.type === 'host/workspace-removed') this.remove(envelope.payload.workspaceId)
    else if (envelope.payload.type === 'host/workspace-order-changed') {
      this.orderFrameGeneration++
      this.installOrder(envelope.payload.workspaceIds, true)
    }
    else if (envelope.payload.type === 'host/archived-sessions-changed') {
      this.installArchived(envelope.payload.archivedSessionIds)
    }
  }

  /** Re-pull the baseline after each connection generation. */
  handleConnected(): void {
    void this.refresh()
  }

  /**
   * Subscribe to workspace snapshot invalidation.
   * @param listener - snapshot invalidation callback.
   * @returns unsubscribe function.
   */
  subscribe(listener: () => void): () => void {
    return this.notifier.subscribe(listener)
  }

  /**
   * Read the cached workspace snapshot after flushing pending notifications.
   * @returns the cached workspace snapshot.
   */
  getSnapshot(): WorkspaceListSnapshot {
    this.notifier.ensureFresh()
    return this.snapshotCache
  }

  private buildSnapshot(): WorkspaceListSnapshot {
    return {
      items: this.itemViews(),
      archivedSessionIds: this.archivedSessionIds,
      state: this.state,
      phase: this.phase,
      error: this.error,
    }
  }

  /**
   * Replace the archive set when membership actually changed (array identity
   * backs Object.is short-circuits). Host snapshots are append-ordered, so
   * positional comparison is exact, not merely heuristic.
   */
  private installArchived(archivedSessionIds: readonly SessionId[]): void {
    if (this.refreshFrames !== null) this.archivedSupersedesRefresh = true
    if (archivedSessionIds.length === this.archivedSessionIds.length
      && archivedSessionIds.every((id, index) => id === this.archivedSessionIds[index])) return
    this.archivedSessionIds = [...archivedSessionIds]
    this.notifier.markDirty()
  }

  /** Reorder known Workspace objects, optionally recording a Host-committed sequence. */
  private installOrder(workspaceIds: readonly WorkspaceId[], committed = false): void {
    if (committed) {
      this.refreshFrames?.push({ type: 'order', workspaceIds })
      this.committedOrder = [...workspaceIds]
    }
    const rank = new Map(workspaceIds.map((id, index) => [id, index]))
    const items = [...this.items].sort((left, right) => {
      const leftId = left.getSnapshot().view?.workspaceId
      const rightId = right.getSnapshot().view?.workspaceId
      return (leftId === undefined ? Number.MAX_SAFE_INTEGER : rank.get(leftId) ?? Number.MAX_SAFE_INTEGER)
        - (rightId === undefined ? Number.MAX_SAFE_INTEGER : rank.get(rightId) ?? Number.MAX_SAFE_INTEGER)
    })
    if (items.every((item, index) => item === this.items[index])) return
    this.items = items
    this.notifier.markDirty()
  }

  /** Upsert one Host view, optionally retaining the local object that materialized it. */
  private upsert(view: WorkspaceView, identity?: Workspace): void {
    if (this.removedIds.has(view.workspaceId)) return
    this.refreshFrames?.push({ type: 'upsert', workspace: view })
    const index = this.items.findIndex(item => item.getSnapshot().view?.workspaceId === view.workspaceId)
    // Mutation responses and changed frames race (two carriers, no ordering):
    // reject a snapshot strictly older than the installed projection so a
    // late unary response cannot roll back a newer frame.
    const installed = index === -1 ? undefined : this.items[index]?.getSnapshot().view
    if (installed !== undefined && Date.parse(view.updatedAt) < Date.parse(installed.updatedAt)) return
    if (!this.committedOrder.includes(view.workspaceId)) {
      this.committedOrder = [view.workspaceId, ...this.committedOrder]
    }
    if (identity !== undefined) {
      this.items = index === -1
        ? [identity, ...this.items]
        : this.items.map((item, position) => position === index ? identity : item)
    } else if (index === -1) {
      this.items = [new Workspace(this.api, view), ...this.items]
    } else {
      this.items[index]?.adopt(view)
      this.items = [...this.items]
    }
    this.notifier.markDirty()
  }

  /** Remove one id idempotently and retain a tombstone against late echoes. */
  private remove(workspaceId: WorkspaceId, direct = false): void {
    this.refreshFrames?.push({ type: 'remove', workspaceId })
    this.removedIds.add(workspaceId)
    this.committedOrder = this.committedOrder.filter(id => id !== workspaceId)
    const items = this.items.filter(item =>
      item.getSnapshot().view?.workspaceId !== workspaceId)
    if (items.length === this.items.length) {
      // The Host frame may have removed the row first but left its batched
      // notification pending. A successful unary echo still flushes that
      // committed state before the user action resolves.
      if (direct) this.notifier.notifyNow()
      return
    }
    this.items = items
    if (direct) this.notifier.notifyNow()
    else this.notifier.markDirty()
  }

  private installViews(views: readonly WorkspaceView[]): void {
    const existing = new Map(
      this.items.flatMap((workspace) => {
        const view = workspace.getSnapshot().view
        return view === undefined ? [] : [[view.workspaceId, workspace] as const]
      }),
    )
    const installed = new Map<WorkspaceView['workspaceId'], Workspace>()
    for (const view of views) {
      const duplicate = installed.get(view.workspaceId)
      if (duplicate !== undefined) {
        duplicate.adopt(view)
        continue
      }
      const workspace = existing.get(view.workspaceId) ?? new Workspace(this.api, view)
      workspace.adopt(view)
      installed.set(view.workspaceId, workspace)
    }
    this.items = [...installed.values()]
    this.committedOrder = views.map(view => view.workspaceId)
  }

  private itemViews(): readonly WorkspaceView[] {
    if (this.itemViewsSource === this.items) return this.itemViewsCache
    this.itemViewsSource = this.items
    this.itemViewsCache = this.items.flatMap((workspace) => {
      const view = workspace.getSnapshot().view
      return view === undefined ? [] : [view]
    })
    return this.itemViewsCache
  }
}

/** Known ids retain their position; a newly created Workspace enters first. */
function upsertWorkspace(items: readonly WorkspaceView[], workspace: WorkspaceView): WorkspaceView[] {
  const index = items.findIndex(item => item.workspaceId === workspace.workspaceId)
  return index === -1
    ? [workspace, ...items]
    : items.map((item, position) => position === index ? workspace : item)
}

/** Replay one ordered delta over a baseline: upsert in place, or drop the removed id. */
function applyWorkspaceDelta(items: readonly WorkspaceView[], delta: WorkspaceDelta): WorkspaceView[] {
  if (delta.type === 'upsert') return upsertWorkspace(items, delta.workspace)
  if (delta.type === 'remove') {
    return items.filter(workspace => workspace.workspaceId !== delta.workspaceId)
  }
  const rank = new Map(delta.workspaceIds.map((id, index) => [id, index]))
  return [...items].sort((left, right) =>
    (rank.get(left.workspaceId) ?? Number.MAX_SAFE_INTEGER)
    - (rank.get(right.workspaceId) ?? Number.MAX_SAFE_INTEGER))
}

/** Move one known id before an optional anchor; unknown ids leave the order unchanged. */
function insertIdBefore(
  ids: readonly WorkspaceId[],
  id: WorkspaceId,
  beforeId?: WorkspaceId,
): WorkspaceId[] {
  if (!ids.includes(id) || (beforeId !== undefined && !ids.includes(beforeId)) || beforeId === id) {
    return [...ids]
  }
  const without = ids.filter(candidate => candidate !== id)
  const at = beforeId === undefined ? without.length : without.indexOf(beforeId)
  return [...without.slice(0, at), id, ...without.slice(at)]
}
