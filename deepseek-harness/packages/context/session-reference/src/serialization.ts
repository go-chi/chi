/** Tag-safe JSON serialization for the model-visible reference envelope. */

/**
 * Serialize JSON while preventing source data from spelling an XML-like opening tag.
 * @param value - JSON-compatible reference data.
 * @returns JSON whose parse result is unchanged and whose data contains no literal `<`.
 */
export function stringifyTagSafeJson(value: unknown): string {
  const serialized: unknown = JSON.stringify(value)
  if (typeof serialized !== 'string') throw new TypeError('session-reference data is not JSON-serializable')
  return serialized.replaceAll('<', '\\u003c')
}
