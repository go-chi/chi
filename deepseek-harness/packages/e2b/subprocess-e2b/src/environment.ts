/** Shared remote-environment scrubbing for E2B process and terminal launchers. */

import { Buffer } from 'node:buffer'
import { posix } from 'node:path'
import { e2bControlEnvs } from '@deepseek-ai/dsh-e2b'
import type { Sandbox } from '@deepseek-ai/dsh-e2b'
import { SENSITIVE_ENV_PATTERN } from '@deepseek-ai/dsh-subprocess'

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

function remoteEnvironmentEntries(raw: string): Array<readonly [string, string]> {
  const entries: Array<readonly [string, string]> = []
  for (const entry of raw.split('\0')) {
    if (entry.length === 0) continue
    const separator = entry.indexOf('=')
    if (separator <= 0) continue
    entries.push([entry.slice(0, separator), entry.slice(separator + 1)])
  }
  return entries
}

/**
 * Read the remote environment through ASCII base64 so SDK callback chunking cannot corrupt UTF-8.
 * @param sandbox - shared E2B execution world.
 * @param signal - optional cancellation for the control-plane request.
 * @returns the complete NUL-delimited UTF-8 environment.
 */
export async function readRemoteEnvironment(sandbox: Sandbox, signal?: AbortSignal): Promise<string> {
  // TODO(e2b-replace-environment): Remove this ambient probe when E2B can start
  // a command with a replacement environment instead of merged overrides.
  const result = await sandbox.commands.run(
    'set -o pipefail; dsh_e2b_passwd="$(getent passwd "$(id -u)")"; IFS=: read -r _ _ _ _ _ dsh_e2b_home _ <<<"$dsh_e2b_passwd"; test -n "$dsh_e2b_home" -a -d "$dsh_e2b_home"; printf \'%s\' "$dsh_e2b_home" | base64 -w 0; printf \'\\n\'; env -0 | base64 -w 0',
    { envs: e2bControlEnvs(), ...(signal === undefined ? {} : { signal }) },
  )
  const lines = result.stdout.trim().split('\n')
  if (lines.length !== 2 || !lines.every(line => BASE64.test(line))) {
    throw new Error('subprocess-e2b: remote environment transport returned invalid base64')
  }
  const [encodedHome, encodedEnvironment] = lines as [string, string]
  let home: string
  let raw: string
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true })
    home = decoder.decode(Buffer.from(encodedHome, 'base64'))
    raw = decoder.decode(Buffer.from(encodedEnvironment, 'base64'))
  } catch (error: unknown) {
    throw new Error('subprocess-e2b: remote environment is not valid UTF-8', { cause: error })
  }
  if (!posix.isAbsolute(home) || home.includes('\0')) {
    throw new Error(`subprocess-e2b: remote login home is invalid: ${JSON.stringify(home)}`)
  }
  const environment = new Map(remoteEnvironmentEntries(raw))
  environment.set('HOME', home)
  return [...environment].map(([name, value]) => `${name}=${value}\0`).join('')
}

/**
 * Parse an E2B NUL-delimited environment while removing harness-private and credential-shaped names.
 * @param raw - The complete NUL-delimited remote environment.
 * @returns Mutable retained entries for the caller to overlay and serialize.
 */
export function scrubRemoteEnvironment(raw: string): Map<string, string> {
  const environment = new Map<string, string>()
  for (const [name, value] of remoteEnvironmentEntries(raw)) {
    if (name.startsWith('DSH_') || SENSITIVE_ENV_PATTERN.test(name)) continue
    environment.set(name, value)
  }
  return environment
}

/**
 * Isolate E2B's fixed login-shell bootstrap from user profiles and ambient credentials.
 * @param raw - The complete NUL-delimited remote environment.
 * @returns Explicit E2B command or PTY overrides for bootstrap-shell startup.
 */
export function bootstrapEnvironment(raw: string): Record<string, string> {
  const environment: Record<string, string> = { TERM: 'dumb' }
  for (const [name] of remoteEnvironmentEntries(raw)) {
    if (name.startsWith('DSH_') || SENSITIVE_ENV_PATTERN.test(name)) environment[name] = ''
  }
  return environment
}

/**
 * Overlay explicit entries and serialize one validated E2B environment.
 * @param raw - The complete NUL-delimited remote environment.
 * @param explicit - Deliberate caller overrides applied after ambient scrubbing; an `undefined` tombstone removes an ambient entry.
 * @returns NUL-delimited `name=value` entries accepted by `env -i`.
 */
export function serializeRemoteEnvironment(
  raw: string,
  explicit: Readonly<NodeJS.ProcessEnv> | undefined,
): string {
  const environment = scrubRemoteEnvironment(raw)
  for (const [name, value] of Object.entries(explicit ?? {})) {
    if (name.length === 0 || name.includes('=') || name.includes('\0') || value?.includes('\0') === true) {
      throw new Error('subprocess-e2b: environment entries require non-empty NUL-free names without = and NUL-free values')
    }
    // An explicit undefined is the seam's tombstone: remove the ambient entry.
    if (value === undefined) environment.delete(name)
    else environment.set(name, value)
  }
  return [...environment].map(([name, value]) => `${name}=${value}\0`).join('')
}
