/** Shared teardown for ACP example tests. */

import { rm } from 'node:fs/promises'
import type { LaunchedAcpTestAgent } from '@deepseek-ai/dsh-acp-snapshot'

/**
 * Close the test agent, then remove its workspace, attempting both operations
 * and reporting every failure instead of allowing the later one to mask the
 * earlier one.
 */
export async function cleanupAcpExampleTest(
  spawned: Pick<LaunchedAcpTestAgent, 'close'> | undefined,
  workdir: string | undefined,
): Promise<void> {
  const results: PromiseSettledResult<unknown>[] = []
  if (spawned !== undefined) results.push(...await Promise.allSettled([spawned.close('SIGKILL')]))
  if (workdir !== undefined) results.push(...await Promise.allSettled([rm(workdir, { recursive: true, force: true })]))

  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map(result => result.reason as unknown)
  if (failures.length > 0) throw new AggregateError(failures, 'ACP example cleanup failed')
}
