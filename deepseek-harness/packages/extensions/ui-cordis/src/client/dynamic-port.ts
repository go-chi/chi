/** Host operations used directly by the frame-wide Cordis panel. */

import type { SessionId } from '@deepseek-ai/dsh-client-connection/client'
import type {
  CordisDynamicPluginId, DynamicCordisInventoryRow,
} from './events.ts'

/** Result of a panel lifecycle gesture. */
export type CordisActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string }

/** RPC seam kept outside the React surface. */
export interface CordisDynamicPort {
  /** Stop one Plugin while retaining its immutable Packages. */
  stop(sessionId: SessionId, pluginId: CordisDynamicPluginId): Promise<CordisActionResult>
  /** Stop and remove one Plugin together with every Package. */
  remove(sessionId: SessionId, pluginId: CordisDynamicPluginId): Promise<CordisActionResult>
  /** Read the frame-wide Plugin inventory. */
  inventory(): Promise<readonly DynamicCordisInventoryRow[]>
}

/** One stable Plugin row as the panel receives it. */
export type CordisInventoryRow = DynamicCordisInventoryRow
