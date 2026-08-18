/** Shared status derivation over Host inventory and this page's Client live set. */

import type { DynamicCordisLivePackage } from '@deepseek-ai/dsh-cordis-client-runner/client'
import type {
  CordisDynamicPackageId, DynamicCordisInventoryRow,
} from './events.ts'

/** The three product-visible lifecycle readings. */
export type CordisVisibleStatus = 'idle' | 'client-pending' | 'running'

/**
 * Locate one immutable Package inside a Plugin row.
 * @param row - owning Plugin inventory row.
 * @param packageId - immutable Package identity to locate.
 * @returns the matching Package metadata, or `undefined` when absent.
 */
export function packageOf(
  row: DynamicCordisInventoryRow,
  packageId: CordisDynamicPackageId,
): DynamicCordisInventoryRow['packages'][number] | undefined {
  return row.packages.find(pkg => pkg.packageId === packageId)
}

/**
 * Derive the visible state of one Package.
 * @param row - owning Plugin inventory row.
 * @param packageId - Package being described.
 * @param loaded - Client activations loaded in this page.
 * @returns idle, Host-running/Client-pending, or fully running.
 */
export function cordisVisibleStatus(
  row: DynamicCordisInventoryRow,
  packageId: CordisDynamicPackageId,
  loaded: readonly DynamicCordisLivePackage[],
): CordisVisibleStatus {
  const run = row.activeRun
  if (run === undefined || run.packageId !== packageId) return 'idle'
  const pkg = packageOf(row, packageId)
  if (pkg?.hasClientHalf !== true) return 'running'
  return loaded.some(live => live.pluginId === row.pluginId
    && live.packageId === packageId
    && live.pluginRunId === run.pluginRunId)
    ? 'running'
    : 'client-pending'
}
