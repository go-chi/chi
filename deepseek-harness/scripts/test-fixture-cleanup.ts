/**
 * Junction-safe fixture cleanup for Windows. Test fixtures junction the REAL
 * `scripts/`, `node_modules`, and tsx package directories so installer probes
 * resolve through them; Windows recursive deletion — both Node's `rmSync` and
 * Git's `worktree remove` — follows MOUNT_POINT junctions into their targets
 * and would delete the repository's own directories. POSIX `unlink`/`rm`
 * already remove symlinks without following them, so the walk is a no-op
 * there.
 */

import { lstatSync, readdirSync, rmSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Recursively unlink every symbolic link (junction) under `path`.
 * @param path - the fixture tree whose reparse points are unlinked.
 */
export function unlinkFixtureLinks(path: string): void {
  const visit = (entry: string): void => {
    let stat: ReturnType<typeof lstatSync>
    try {
      stat = lstatSync(entry)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      if (stat.isSymbolicLink()) unlinkSync(entry)
      return
    }
    for (const child of readdirSync(entry)) visit(join(entry, child))
  }
  visit(path)
}

/**
 * Remove one fixture tree after its junctions are unlinked (see
 * {@link unlinkFixtureLinks}). Retries the removal: Windows releases child
 * process and antivirus file handles asynchronously, and an unretried
 * `rmSync` fails immediately with EPERM under load. A 10-second retry window
 * (50 attempts × 200 ms) covers the failover pool's slow handle release;
 * release is one-shot (a terminated child's handles drain, not reacquired),
 * so a bounded window suffices and never pins afterEach cleanup.
 * @param path - the fixture tree to remove.
 */
export function removeFixtureSafely(path: string): void {
  unlinkFixtureLinks(path)
  rmSync(path, { recursive: true, force: true, maxRetries: 50, retryDelay: 200 })
}
