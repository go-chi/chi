/**
 * Content identity for workspace instruction duplicate suppression.
 *
 * @module @deepseek-ai/dsh-agent-instructions/digest
 */

import { createHash } from 'node:crypto'

/**
 * Compute the content identity used across instruction loading and session state.
 * @param content - exact UTF-8 instruction text.
 * @returns lowercase SHA-1 digest in hexadecimal form.
 */
export function instructionContentSha1(content: string): string {
  return createHash('sha1').update(content).digest('hex')
}

/**
 * Compute the whitespace-insensitive identity used for per-directory duplicate
 * suppression. Leading and trailing whitespace is trimmed before hashing so a
 * symlinked or byte-copied sibling that differs only by surrounding whitespace
 * still collapses to a single rendered file.
 * @param content - exact UTF-8 instruction text.
 * @returns SHA-1 digest of the trimmed content.
 */
export function trimmedInstructionDigest(content: string): string {
  return instructionContentSha1(content.trim())
}
