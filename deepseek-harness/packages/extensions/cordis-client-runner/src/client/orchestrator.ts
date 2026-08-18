/**
 * Page-side run orchestration for model approvals and direct panel gestures.
 * Host activation always precedes Client loading. The same Plugin-keyed state
 * drives every surface, so remounting a panel never loses an open approval or
 * an in-flight transition.
 */

import type {
  ApprovalRequestId,
  CordisDynamicPackageId,
  CordisDynamicPluginId,
  CordisDynamicPluginRunId,
  CordisDynamicRunMode,
  DynamicCordisClientSource,
  DynamicCordisHostHalfResult,
  DynamicCordisInventoryRow,
  DynamicCordisResolveAck,
  DynamicCordisRunResolution,
  DynamicCordisRunResponse,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-client-connection/client'
import { errorDetails } from './runtime.ts'
import type { CordisErrorDetails, CordisObservable, DynamicCordisPackageRunner } from './runtime.ts'

/** One Plugin's in-flight approval or activation. */
export type CordisRunActivity =
  | {
    phase: 'awaiting-approval'
    requestId: ApprovalRequestId
    agentId: SessionId
    packageId: CordisDynamicPackageId
    mode: CordisDynamicRunMode
    name: string
    purpose: string
  }
  | {
    phase: 'orchestrating'
    agentId: SessionId
    packageId: CordisDynamicPackageId
    mode: CordisDynamicRunMode
  }

/** Why this page's latest activation attempt failed. */
export interface CordisRunFailure {
  /** Package the attempt targeted. */
  packageId: CordisDynamicPackageId
  /** Which half or settlement stage failed. */
  reason: 'host-half-failed' | 'client-half-failed'
  /** Actionable failure text. */
  message: string
  /** Original failure stack when available. */
  stack?: string
}

/** Host operations consumed by the orchestrator after transport folding. */
export interface CordisRunHostSeam {
  /** Start a new Host activation or attach this page to an existing one. */
  runHostHalf(
    agentId: SessionId,
    pluginId: CordisDynamicPluginId,
    packageId: CordisDynamicPackageId,
    mode: CordisDynamicRunMode,
    requestId: ApprovalRequestId | null,
    approveFutureVersions: boolean,
  ): Promise<DynamicCordisHostHalfResult>
  /** Fetch Client source for one exact active run. */
  getClientCode(
    agentId: SessionId,
    pluginId: CordisDynamicPluginId,
    pluginRunId: CordisDynamicPluginRunId,
  ): Promise<DynamicCordisClientSource>
  /** Settle a model-driven approval. */
  resolveRequestRun(
    requestId: ApprovalRequestId,
    resolution: DynamicCordisRunResolution,
  ): Promise<DynamicCordisResolveAck>
  /** Settle a direct panel activation after this page handles its Client half. */
  settleUserRun(
    agentId: SessionId,
    pluginId: CordisDynamicPluginId,
    resolution: DynamicCordisRunResolution,
  ): Promise<DynamicCordisRunResponse>
}

/** Dependencies of one page's orchestrator. */
export interface CordisRunOrchestratorEnv {
  /** Page-local Client loader. */
  runner: DynamicCordisPackageRunner
  /** Folded Host RPC operations. */
  host: CordisRunHostSeam
}

/** Forwarded approval request fields used by this page. */
export interface CordisRunRequest {
  requestId: ApprovalRequestId
  agentId: SessionId
  pluginId: CordisDynamicPluginId
  packageId: CordisDynamicPackageId
  mode: CordisDynamicRunMode
  name: string
  purpose: string
  requiresApproval: boolean
}

/** Direct panel activation request. */
export interface CordisUserRunRequest {
  agentId: SessionId
  pluginId: CordisDynamicPluginId
  packageId: CordisDynamicPackageId
  mode: CordisDynamicRunMode
  /** Host-only Packages finish without a Client load or settlement call. */
  hasClientHalf: boolean
}

interface RunPlan extends CordisUserRunRequest {
  requestId?: ApprovalRequestId
  approveFutureVersions?: boolean
}

/** Drives Host → Client activation and publishes Plugin-keyed activity. */
export class CordisRunOrchestrator {
  private readonly requests = new Map<ApprovalRequestId, CordisRunRequest>()
  private readonly activity = new Map<CordisDynamicPluginId, CordisRunActivity>()
  private readonly failures = new Map<CordisDynamicPluginId, CordisRunFailure>()
  private readonly inFlight = new Map<CordisDynamicPluginId, Promise<void>>()
  private readonly listeners = new Set<() => void>()
  private activityCache: ReadonlyMap<CordisDynamicPluginId, CordisRunActivity> | undefined
  private failureCache: ReadonlyMap<CordisDynamicPluginId, CordisRunFailure> | undefined

  /** @param env - Client loader and folded Host operations. */
  constructor(private readonly env: CordisRunOrchestratorEnv) {}

  /** Open approvals and current activation attempts, keyed by stable Plugin ID. */
  readonly activeRuns: CordisObservable<ReadonlyMap<CordisDynamicPluginId, CordisRunActivity>> = {
    getSnapshot: () => this.activityCache ??= new Map(this.activity),
    subscribe: fn => this.observe(fn),
  }

  /** Latest page-side activation failure for each Plugin. */
  readonly lastRunError: CordisObservable<ReadonlyMap<CordisDynamicPluginId, CordisRunFailure>> = {
    getSnapshot: () => this.failureCache ??= new Map(this.failures),
    subscribe: fn => this.observe(fn),
  }

  /**
   * Register a Client activation request, starting it immediately when the Plugin is already authorized.
   * @param request - forwarded approval and activation metadata.
   */
  open(request: CordisRunRequest): void {
    this.requests.set(request.requestId, request)
    if (!request.requiresApproval) {
      void this.orchestrate({
        agentId: request.agentId,
        pluginId: request.pluginId,
        packageId: request.packageId,
        mode: request.mode,
        requestId: request.requestId,
        hasClientHalf: true,
      }).catch((error: unknown) => {
        console.error(`[cordis-client-runner] automatic activation ${request.requestId} failed:`, error)
      })
      return
    }
    if (this.activity.get(request.pluginId)?.phase !== 'orchestrating') {
      this.activity.set(request.pluginId, {
        phase: 'awaiting-approval',
        requestId: request.requestId,
        agentId: request.agentId,
        packageId: request.packageId,
        mode: request.mode,
        name: request.name,
        purpose: request.purpose,
      })
    }
    this.commit()
  }

  /**
   * Rebuild pending approvals and automatic Client activations from an authoritative Host inventory read.
   * @param rows - complete process-wide Plugin inventory.
   */
  reconcileApprovals(rows: readonly DynamicCordisInventoryRow[]): void {
    const expected = new Map<ApprovalRequestId, CordisRunRequest>()
    for (const row of rows) {
      const attempt = row.latestRun
      if (attempt?.approvalRequestId === undefined
        || (attempt.status !== 'awaiting-approval'
          && attempt.status !== 'starting-host'
          && attempt.status !== 'client-pending')) continue
      const pkg = row.packages.find(candidate => candidate.packageId === attempt.packageId)
      if (pkg === undefined) continue
      expected.set(attempt.approvalRequestId, {
        requestId: attempt.approvalRequestId,
        agentId: row.agentId,
        pluginId: row.pluginId,
        packageId: attempt.packageId,
        mode: attempt.mode,
        name: pkg.name,
        purpose: pkg.purpose,
        requiresApproval: attempt.requiresApproval ?? attempt.status === 'awaiting-approval',
      })
    }

    let changed = false
    for (const [requestId, request] of [...this.requests]) {
      if (expected.has(requestId)) continue
      this.requests.delete(requestId)
      const current = this.activity.get(request.pluginId)
      if (current?.phase === 'awaiting-approval' && current.requestId === requestId) {
        this.activity.delete(request.pluginId)
      }
      changed = true
    }
    for (const [requestId, request] of expected) {
      const previous = this.requests.get(requestId)
      const current = this.activity.get(request.pluginId)
      if (!request.requiresApproval && current?.phase === 'orchestrating') continue
      if (request.requiresApproval
        && sameRequest(previous, request)
        && current?.phase === 'awaiting-approval'
        && current.requestId === requestId) continue
      if (!request.requiresApproval) {
        this.open(request)
        changed = true
        continue
      }
      this.requests.set(requestId, request)
      if (current?.phase !== 'orchestrating') {
        this.activity.set(request.pluginId, {
          phase: 'awaiting-approval',
          requestId,
          agentId: request.agentId,
          packageId: request.packageId,
          mode: request.mode,
          name: request.name,
          purpose: request.purpose,
        })
      }
      changed = true
    }
    if (changed) this.commit()
  }

  /**
   * Close an approval settled by another page or by cancellation.
   * @param requestId - approval request that can no longer be answered here.
   */
  close(requestId: ApprovalRequestId): void {
    const request = this.requests.get(requestId)
    if (request === undefined) return
    this.requests.delete(requestId)
    const current = this.activity.get(request.pluginId)
    if (current?.phase === 'awaiting-approval' && current.requestId === requestId) {
      this.activity.delete(request.pluginId)
    }
    this.commit()
  }

  /**
   * Approve and execute one still-open model request.
   * @param requestId - approval request to execute.
   * @param approveFutureVersions - whether this approval covers later Packages for the same Plugin.
   */
  approve(requestId: ApprovalRequestId, approveFutureVersions: boolean): Promise<void> {
    const request = this.requests.get(requestId)
    if (request === undefined || !request.requiresApproval) return Promise.resolve()
    return this.orchestrate({
      agentId: request.agentId,
      pluginId: request.pluginId,
      packageId: request.packageId,
      mode: request.mode,
      requestId,
      approveFutureVersions,
      hasClientHalf: true,
    })
  }

  /**
   * Reject one still-open model request without executing either half.
   * @param requestId - approval request to reject.
   */
  async decline(requestId: ApprovalRequestId): Promise<void> {
    const request = this.requests.get(requestId)
    if (request === undefined || !request.requiresApproval) return
    const current = this.activity.get(request.pluginId)
    if (current?.phase !== 'awaiting-approval' || current.requestId !== requestId) return
    this.requests.delete(requestId)
    this.activity.delete(request.pluginId)
    this.commit()
    await this.answer(requestId, { ok: false, reason: 'rejected' })
  }

  /**
   * Execute a direct panel run; the user gesture itself authorizes it.
   * @param request - exact Package activation selected by the user.
   */
  startUserRun(request: CordisUserRunRequest): Promise<void> {
    return this.orchestrate(request)
  }

  private observe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  private commit(): void {
    this.activityCache = undefined
    this.failureCache = undefined
    for (const fn of [...this.listeners]) fn()
  }

  private orchestrate(plan: RunPlan): Promise<void> {
    const running = this.inFlight.get(plan.pluginId)
    if (running !== undefined) return running
    this.activity.set(plan.pluginId, {
      phase: 'orchestrating',
      agentId: plan.agentId,
      packageId: plan.packageId,
      mode: plan.mode,
    })
    this.failures.delete(plan.pluginId)
    if (plan.requestId !== undefined) this.requests.delete(plan.requestId)
    this.commit()
    const attempt = this.drive(plan).finally(() => {
      this.inFlight.delete(plan.pluginId)
      this.activity.delete(plan.pluginId)
      this.commit()
    })
    this.inFlight.set(plan.pluginId, attempt)
    return attempt
  }

  private async drive(plan: RunPlan): Promise<void> {
    const started = await this.startHost(plan)
    if (!started.ok) {
      this.fail(plan, 'host-half-failed', started)
      if (plan.requestId !== undefined) {
        await this.answer(plan.requestId, { ...started, reason: 'host-half-failed' })
      }
      return
    }
    if (!plan.hasClientHalf) return

    let source: DynamicCordisClientSource
    try {
      source = await this.env.host.getClientCode(plan.agentId, plan.pluginId, started.pluginRunId)
    } catch (error) {
      await this.finishClientFailure(plan, started.pluginRunId, started.startedHere, errorDetails(error), error)
      return
    }
    const loaded = await this.env.runner.load({
      pluginId: source.pluginId,
      packageId: source.packageId,
      pluginRunId: source.pluginRunId,
      agentId: plan.agentId,
      name: source.name,
      code: source.code,
    }).catch((error: unknown) => ({ ok: false, cause: 'evaluate', ...errorDetails(error), error }) as const)
    if (!loaded.ok) {
      await this.finishClientFailure(
        plan,
        started.pluginRunId,
        started.startedHere,
        {
          message: `${loaded.cause}: ${loaded.message}`,
          ...loaded.stack === undefined ? {} : { stack: loaded.stack },
        },
        loaded.error,
      )
      return
    }
    const resolution: DynamicCordisRunResolution = {
      ok: true,
      pluginRunId: loaded.pluginRunId,
      ...loaded.waitingFor === undefined ? {} : { waitingFor: loaded.waitingFor },
    }
    if (plan.requestId !== undefined) {
      await this.answer(plan.requestId, resolution)
      return
    }
    await this.settleDirect(plan, resolution)
  }

  private async startHost(plan: RunPlan): Promise<DynamicCordisHostHalfResult> {
    try {
      return await this.env.host.runHostHalf(
        plan.agentId,
        plan.pluginId,
        plan.packageId,
        plan.mode,
        plan.requestId ?? null,
        plan.approveFutureVersions ?? false,
      )
    } catch (error) {
      return { ok: false, ...errorDetails(error) }
    }
  }

  private async finishClientFailure(
    plan: RunPlan,
    pluginRunId: CordisDynamicPluginRunId,
    startedHere: boolean,
    failure: CordisErrorDetails,
    originalError?: unknown,
  ): Promise<void> {
    console.error(
      `[cordis-client-runner] Client activation ${plan.pluginId}/${plan.packageId} (${pluginRunId}) failed:`,
      originalError ?? failure,
    )
    this.fail(plan, 'client-half-failed', failure)
    const resolution: DynamicCordisRunResolution = {
      ok: false,
      reason: 'client-half-failed',
      pluginRunId,
      startedHere,
      ...failure,
    }
    if (plan.requestId !== undefined) await this.answer(plan.requestId, resolution)
    else await this.settleDirect(plan, resolution)
  }

  private async settleDirect(plan: RunPlan, resolution: DynamicCordisRunResolution): Promise<void> {
    try {
      const response = await this.env.host.settleUserRun(plan.agentId, plan.pluginId, resolution)
      if (!response.ok) this.fail(plan, 'client-half-failed', response)
    } catch (error) {
      this.fail(plan, 'client-half-failed', errorDetails(error))
    }
  }

  private async answer(requestId: ApprovalRequestId, resolution: DynamicCordisRunResolution): Promise<void> {
    try {
      await this.env.host.resolveRequestRun(requestId, resolution)
    } catch (error) {
      console.error(`[cordis-client-runner] answering run request ${requestId} failed:`, error)
    }
  }

  private fail(
    plan: Pick<RunPlan, 'pluginId' | 'packageId'>,
    reason: CordisRunFailure['reason'],
    failure: CordisErrorDetails,
  ): void {
    this.failures.set(plan.pluginId, { packageId: plan.packageId, reason, ...failure })
    this.commit()
  }
}

function sameRequest(left: CordisRunRequest | undefined, right: CordisRunRequest): boolean {
  return left?.requestId === right.requestId
    && left.agentId === right.agentId
    && left.pluginId === right.pluginId
    && left.packageId === right.packageId
    && left.mode === right.mode
    && left.name === right.name
    && left.purpose === right.purpose
    && left.requiresApproval === right.requiresApproval
}
