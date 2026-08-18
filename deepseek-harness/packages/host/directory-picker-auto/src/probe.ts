/**
 * PATH probe for the native backend's Linux chooser binaries: one boot-time
 * sampled fact for the resolver, so an attended Linux host without
 * zenity/kdialog keeps the working `browse` interaction instead of a backend
 * whose every pick fails.
 * @module @deepseek-ai/dsh-host-directory-picker-auto/probe
 */

import { accessSync, constants } from 'node:fs'
import { delimiter, join } from 'node:path'

/** The chooser binaries the native backend can drive on Linux (zenity, KDialog fallback). */
const LINUX_CHOOSER_BINARIES = ['zenity', 'kdialog'] as const

/**
 * Whether the current process may execute the candidate path.
 * @param candidate - absolute or PATH-joined file path.
 * @returns true only for an existing executable file.
 */
export function canExecute(candidate: string): boolean {
  try {
    accessSync(candidate, constants.X_OK)
  } catch {
    // Absent or non-executable candidate — the only signals accessSync(X_OK) emits.
    return false
  }
  return true
}

/**
 * Scan a PATH value for one of the native backend's Linux chooser binaries.
 * @param pathValue - the `PATH` environment value (absent or empty scans nothing).
 * @param isExecutable - executability predicate ({@link canExecute} in production; injected for deterministic tests).
 * @returns whether any PATH directory holds an executable chooser binary.
 */
export function hasLinuxChooserBinary(pathValue: string | undefined, isExecutable: (candidate: string) => boolean): boolean {
  for (const dir of (pathValue ?? '').split(delimiter)) {
    if (dir === '') continue
    for (const name of LINUX_CHOOSER_BINARIES) {
      if (isExecutable(join(dir, name))) return true
    }
  }
  return false
}
