/**
 * Path canonicalization for workspace identity.
 * @module @deepseek-ai/dsh-workspace/src/paths
 */

import { realpath } from 'node:fs/promises'

/**
 * Canonicalize a directory path via `fs.realpath`: trailing slashes, `..`
 * segments, and symlinks are all resolved. This is the ONE uniqueness canon of
 * the package — workspace paths are stored canonicalized, uniqueness is
 * string equality of canonicalized paths (a symlink to an existing
 * workspace's directory collides), and attach-time session `cwd` checks go
 * through the same canon. A path that does not exist rejects with the
 * original `ENOENT` — this is `create`'s reject path (a workspace must point
 * at an existing directory).
 * @param path - The path to canonicalize.
 * @returns the canonical absolute path.
 */
export async function realpathNormalize(path: string): Promise<string> {
  return await realpath(path)
}
