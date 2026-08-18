import type { Context } from '@deepseek-ai/cordis'

/**
 * Deployment-style redaction rule for the telemetry e2e: scrubs the fixture
 * credential from body strings, exactly as a real deployment would mount its
 * own rules on the `session-telemetry/record` waterfall.
 */

const SECRET = /sk-e2efixture[0-9]+/g
const PLACEHOLDER = '[E2E-REDACTED]'

function scrub(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(SECRET, PLACEHOLDER)
  if (Array.isArray(value)) return value.map(scrub)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, scrub(entry)]))
  }
  return value
}

export const name = 'telemetry-redact-rule'

/** Mount the fixture scrub rule onto the redact waterfall. */
export function apply(ctx: Context): void {
  ctx.on('session-telemetry/record', (_record, next) => {
    const record = next()
    return { ...record, body: scrub(record.body) }
  })
}
