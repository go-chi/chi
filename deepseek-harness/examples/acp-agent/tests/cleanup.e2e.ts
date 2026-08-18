/** Regression coverage for ACP example teardown. */

import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanupAcpExampleTest } from './cleanup.ts'

let fallbackWorkdir: string | undefined

afterEach(async () => {
  if (fallbackWorkdir !== undefined) await rm(fallbackWorkdir, { recursive: true, force: true })
  fallbackWorkdir = undefined
})

describe('cleanupAcpExampleTest', () => {
  it('removes the workspace after process shutdown fails', async () => {
    fallbackWorkdir = await mkdtemp(join(tmpdir(), 'acp-cleanup-'))
    const closeFailure = new Error('close failed')
    const spawned = { close: vi.fn().mockRejectedValue(closeFailure) }

    await expect(cleanupAcpExampleTest(spawned, fallbackWorkdir))
      .rejects.toMatchObject({ errors: [closeFailure] })
    await expect(access(fallbackWorkdir)).rejects.toThrow()
    fallbackWorkdir = undefined
  })

  it('reports process and workspace failures together', async () => {
    const closeFailure = new Error('close failed')
    const spawned = { close: vi.fn().mockRejectedValue(closeFailure) }

    const failure = await cleanupAcpExampleTest(spawned, '\0').catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(AggregateError)
    expect((failure as AggregateError).errors).toHaveLength(2)
    expect((failure as AggregateError).errors[0]).toBe(closeFailure)
  })
})
