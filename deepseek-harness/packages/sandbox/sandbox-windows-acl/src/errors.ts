/**
 * Fail-closed Win32 error type. Every backend API failure raises this with the
 * API name and the exact Win32 code; the original POC silently ignored every
 * failed call and would run children UNRESTRICTED (fail-open) — that is the
 * failure mode this class exists to prevent.
 * @module @deepseek-ai/dsh-sandbox-windows-acl/errors
 */

export class Win32Error extends Error {
  /** The failing Win32 API name, e.g. `CreateRestrictedToken`. */
  readonly api: string
  /** The Win32 error code (`GetLastError` for BOOL APIs, the HRESULT-style return for ACL APIs). */
  readonly win32Code: number

  constructor(api: string, win32Code: number, detail?: string) {
    super(`${api} failed (Win32 ${win32Code})${detail === undefined ? '' : `: ${detail}`}`)
    this.name = 'Win32Error'
    this.api = api
    this.win32Code = win32Code
  }
}
