import { describe, expect, it } from 'vitest'
import { AGENT_A, CLIENT_CODE, setup } from './helpers.ts'

const HOST = 'return { apply() {} }'

describe('dynamic Plugin versions', () => {
  it('keeps currentPackageId when an update fails and clears nextPackageId after rollback', async () => {
    const { runner } = await setup()
    const first = runner.define({
      sessionId: AGENT_A.id,
      plugin: { kind: 'new', idPrefix: 'clock' },
      name: 'clock v1',
      purpose: 'show time',
      code: { host: HOST },
    })
    await expect(runner.run(AGENT_A, first.pluginId, first.packageId, 'run')).resolves.toMatchObject({ ok: true })

    const second = runner.define({
      sessionId: AGENT_A.id,
      plugin: { kind: 'existing', pluginId: first.pluginId },
      name: 'clock v2',
      purpose: 'show time',
      code: { host: 'throw new Error("broken update")' },
    })
    await expect(runner.run(AGENT_A, first.pluginId, second.packageId, 'update'))
      .resolves.toMatchObject({ ok: false, reason: 'host-half-failed' })
    expect(runner.inventory()[0]).toMatchObject({
      currentPackageId: first.packageId,
      nextPackageId: second.packageId,
    })
    expect(runner.inventory()[0]?.activeRun).toBeUndefined()

    await expect(runner.run(AGENT_A, first.pluginId, first.packageId, 'run')).resolves.toMatchObject({ ok: true })
    expect(runner.inventory()[0]).toMatchObject({
      currentPackageId: first.packageId,
      activeRun: { packageId: first.packageId },
    })
    expect(runner.inventory()[0]?.nextPackageId).toBeUndefined()
  })

  it('cancels and retracts a Host activation owned by the pending approval', async () => {
    const { runner, gateway } = await setup()
    const defined = runner.define({
      sessionId: AGENT_A.id,
      plugin: { kind: 'new', idPrefix: 'panel' },
      name: 'panel',
      purpose: 'render a panel',
      code: { host: HOST, client: CLIENT_CODE },
    })
    const controller = new AbortController()
    const pending = runner.run(AGENT_A, defined.pluginId, defined.packageId, 'run', controller.signal)
    await Promise.resolve()
    const request = gateway.events.find(([event]) => event === 'cordis/request-run')?.[1]
    expect(request).toBeDefined()
    const approval = request as {
      requestId: Parameters<typeof runner.runHostHalf>[4]
    }
    await expect(runner.runHostHalf(
      AGENT_A,
      defined.pluginId,
      defined.packageId,
      'run',
      approval.requestId,
      false,
    )).resolves.toMatchObject({ ok: true, startedHere: true })

    controller.abort()

    await expect(pending).resolves.toMatchObject({ ok: true, status: 'awaiting-approval' })
    expect(runner.inventory()[0]?.activeRun).toBeDefined()
    await runner.stop(AGENT_A, defined.pluginId)
    expect(runner.inventory()[0]?.activeRun).toBeUndefined()
  })

  it('does not stop an existing Host run when an attaching page fails to load Client code', async () => {
    const { runner } = await setup()
    const defined = runner.define({
      sessionId: AGENT_A.id,
      plugin: { kind: 'new', idPrefix: 'panel' },
      name: 'panel',
      purpose: 'render a panel',
      code: { host: HOST, client: CLIENT_CODE },
    })
    const first = await runner.runHostHalf(AGENT_A, defined.pluginId, defined.packageId, 'run', null, false)
    expect(first).toMatchObject({ ok: true, startedHere: true })
    if (!first.ok) throw new Error(first.message)
    await expect(runner.settleUserRun(AGENT_A, defined.pluginId, {
      ok: true,
      pluginRunId: first.pluginRunId,
    })).resolves.toMatchObject({ ok: true })

    const attached = await runner.runHostHalf(AGENT_A, defined.pluginId, defined.packageId, 'run', null, false)
    expect(attached).toMatchObject({ ok: true, startedHere: false })
    if (!attached.ok) throw new Error(attached.message)
    await expect(runner.settleUserRun(AGENT_A, defined.pluginId, {
      ok: false,
      reason: 'client-half-failed',
      pluginRunId: attached.pluginRunId,
      startedHere: attached.startedHere,
      message: 'this page cannot load it',
    })).resolves.toMatchObject({ ok: false, reason: 'client-half-failed' })

    expect(runner.inventory()[0]?.activeRun).toEqual({
      packageId: defined.packageId,
      pluginRunId: first.pluginRunId,
    })
  })
})
