/**
 * credentials domain contract: the web face of the credential-reference seam
 * (`ctx.credentials`). Reads are structurally value-free — a credential view
 * carries configured/source/writable and has no slot for the value — and the
 * value crosses the wire in exactly one direction, inside `credentials.set`.
 * There is no enumeration method by design: clients learn which references
 * exist from settings schemas and values (`apiKeyEnv` fields).
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Wire view of one credential reference's state. */
export interface CredentialView {
  /** Whether any layer currently supplies a non-empty value. */
  configured: boolean
  /** Winning layer when configured (`env`, `file`, …); provider vocabulary. */
  source?: string
  /** Whether `credentials.set`/`credentials.unset` can affect this reference. */
  writable: boolean
}

/** Credentials-domain unary methods (the map keys credentials.* of RpcMethodMap). */
export interface CredentialsApi {
  /**
   * Describe the named references (batch): configured state, winning source,
   * and writability — never values. An invalid reference name is a
   * `bad-request`; an unknown-but-valid one describes as unconfigured.
   */
  describe(request: RpcRequest<{ refs: string[] }>): Promise<RpcResponse<{ credentials: Record<string, CredentialView> }>>

  /**
   * Store one credential value in the writable layer. Rejected with
   * `credential-rejected` while a read-only layer (the live environment)
   * shadows the reference — the write would otherwise appear to succeed while
   * resolution keeps returning the shadowing value.
   */
  set(request: RpcRequest<{ ref: string; value: string }>): Promise<RpcResponse<{}>>

  /**
   * Remove one credential from the writable layer; same shadowing rejection
   * as `set`. Unsetting an absent reference succeeds (idempotent).
   */
  unset(request: RpcRequest<{ ref: string }>): Promise<RpcResponse<{}>>
}
