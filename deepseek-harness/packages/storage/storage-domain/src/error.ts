/**
 * Error vocabulary of the domain data form.
 * @module @deepseek-ai/dsh-storage-domain/src/error
 */

/** Discriminant codes carried by every {@link DomainError}. */
export type DomainErrorCode =
  | 'already-open'
  | 'facet-unsupported'
  | 'invalid-record'
  | 'missing-key'
  | 'closed'

/** Location of the record that failed schema validation at the durable boundary. */
export interface InvalidRecordDetail {
  /** Table holding the rejected record; `''` for the global singleton. */
  readonly table: string
  /** Key of the rejected record; `''` for the global singleton. */
  readonly key: string
}

/** Construction options: standard `cause` plus the `invalid-record` location. */
export interface DomainErrorOptions extends ErrorOptions {
  /** Present exactly when `code` is `invalid-record`. */
  readonly detail?: InvalidRecordDetail
}

/**
 * Error thrown by the domain layer. The `code` is the stable contract
 * consumers may switch on; `message` is diagnostic prose. Backend failures
 * (`backend-not-found`, `version-mismatch`, …) pass through as
 * `StorageError` — the domain layer does not rewrap them.
 */
export class DomainError extends Error {
  override readonly name = 'DomainError'

  /** Present exactly when `code` is `invalid-record`. */
  readonly detail?: InvalidRecordDetail

  /**
   * @param code - Stable discriminant for the failure class.
   * @param message - Human-readable diagnostic detail.
   * @param options - Standard error options plus the `invalid-record` location.
   */
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    options?: DomainErrorOptions,
  ) {
    super(message, options)
    if (options?.detail) this.detail = options.detail
  }
}
