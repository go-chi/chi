/**
 * FFI helper tests with stub binding tables (the failure-paths.spec.ts
 * pattern): error formatting and temp-path decoding defenses, the
 * last-error throwers' detail fallback, pointer decode NULL handling, and
 * the bounded SID comparison's early exits. Pure stubs — no real Win32
 * calls, so these run on every platform; the real-FFI round-trip lives in
 * acl.spec.ts and probe.spec.ts (win32 only).
 */

import { describe, expect, it, vi } from 'vitest'
import koffi from 'koffi'

import { Win32Error } from '../src/errors.ts'
import {
  allocBytes, decodePtr, decodePtrAt, errorText, getTempPath,
  isInvalidHandle, isNullPtr, sameSidAt, throwLastError, throwWin32,
} from '../src/ffi.ts'
import type { NativePtr, Win32Bindings } from '../src/ffi.ts'
import * as abi from '../src/win32-abi.ts'

const PVOID = koffi.pointer('void')

/** A stub whose formatMessageW writes real UTF-16 text (the errorText round-trip). */
function formatApi(): { api: Win32Bindings; formatMessageW: ReturnType<typeof vi.fn> } {
  const formatMessageW = vi.fn((_flags: number, _source: null, _id: number, _lang: number, buffer: Buffer, _size: number, _args: null) => {
    const text = 'access denied'
    buffer.write(text, 'utf16le')
    return text.length
  })
  const api = {
    formatMessageW,
    getLastError: vi.fn(() => 5),
  } as unknown as Win32Bindings
  return { api, formatMessageW }
}

/** A minimal SID allocation: revision@0, subAuthorityCount@1, identifierAuthority@2, subauthorities@8. */
function craftSid(revision: number, count: number, authority: number[] = [0, 0, 0, 0, 0, 0], subs: number[] = []): NativePtr {
  const sid = allocBytes(8 + subs.length * 4)
  koffi.encode(sid, 'uint8', revision)
  koffi.encode(sid, 1, 'uint8', count)
  authority.forEach((byte, index) => {
    koffi.encode(sid, 2 + index, 'uint8', byte)
  })
  subs.forEach((sub, index) => {
    koffi.encode(sid, 8 + index * 4, 'uint32', sub)
  })
  return sid
}

describe('errorText', () => {
  it('decodes the formatted UTF-16 message and trims it', () => {
    const { api } = formatApi()
    expect(errorText(api, 5)).toBe('access denied')
  })

  it('returns an empty string when FormatMessageW formats nothing', () => {
    const api = { formatMessageW: vi.fn(() => 0) } as unknown as Win32Bindings
    expect(errorText(api, 5)).toBe('')
  })
})

describe('getTempPath', () => {
  it('decodes the NUL-terminated temp path GetTempPathW wrote', () => {
    const api = {
      getTempPathW: vi.fn((_length: number, buffer: Buffer) => {
        buffer.write('C:\\TEMP', 'utf16le')
        return 7
      }),
    } as unknown as Win32Bindings
    expect(getTempPath(api)).toBe('C:\\TEMP')
  })

  it('reports the Win32 failure when GetTempPathW writes nothing', () => {
    const { api } = formatApi()
    const failing = { ...api, getTempPathW: vi.fn(() => 0) } as Win32Bindings
    let caught: unknown
    try {
      getTempPath(failing)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).api).toBe('GetTempPathW')
  })
})

describe('throwLastError and throwWin32', () => {
  it('throwLastError formats the system message when no detail is given', () => {
    const { api } = formatApi()
    let caught: unknown
    try {
      throwLastError(api, 'Probe')
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).message).toContain('Probe failed (Win32 5): access denied')
  })

  it('throwWin32 formats the system message when no detail is given', () => {
    const { api } = formatApi()
    let caught: unknown
    try {
      throwWin32(api, 'Probe', 5)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).message).toContain('Probe failed (Win32 5): access denied')
  })

  it('Win32Error appends the detail when one is given', () => {
    const error = new Win32Error('Probe', 5, 'the lock file path')
    expect(error.name).toBe('Win32Error')
    expect(error.api).toBe('Probe')
    expect(error.win32Code).toBe(5)
    expect(error.message).toBe('Probe failed (Win32 5): the lock file path')
  })

  it('Win32Error omits the detail suffix when none is given', () => {
    const error = new Win32Error('Probe', 5)
    expect(error.message).toBe('Probe failed (Win32 5)')
  })
})

describe('pointer NULL handling', () => {
  it('isNullPtr accepts null, undefined, and the zero pointer', () => {
    expect(isNullPtr(null)).toBe(true)
    expect(isNullPtr(undefined)).toBe(true)
    expect(isNullPtr(0n as NativePtr)).toBe(true)
    expect(isNullPtr(42n as NativePtr)).toBe(false)
  })

  it('isInvalidHandle treats NULL as failure', () => {
    expect(isInvalidHandle(null)).toBe(true)
    expect(isInvalidHandle(undefined)).toBe(true)
    expect(isInvalidHandle(0n as NativePtr)).toBe(true)
    expect(isInvalidHandle(42n as NativePtr)).toBe(false)
  })

  it('decodePtrAt returns null for a NULL pointer stored in a buffer', () => {
    const buffer = Buffer.alloc(8)
    buffer.writeBigUInt64LE(0n, 0)
    expect(decodePtrAt(buffer, 0)).toBeNull()
  })

  it('decodePtrAt returns the stored pointer value', () => {
    const buffer = Buffer.alloc(8)
    buffer.writeBigUInt64LE(42n, 0)
    expect(decodePtrAt(buffer, 0)).toBe(42n)
  })

  it('decodePtr returns null for an unset out-parameter slot', () => {
    const slot = koffi.alloc(PVOID, 1) as unknown as NativePtr
    expect(decodePtr(slot)).toBeNull()
  })
})

describe('sameSidAt bounded comparison', () => {
  it('rejects a revision mismatch before comparing anything else', () => {
    const left = craftSid(1, 0)
    const right = craftSid(2, 0)
    expect(sameSidAt(left, 0, right, 0)).toBe(false)
  })

  it('rejects a subauthority-count mismatch', () => {
    const left = craftSid(1, 1, [0, 0, 0, 0, 0, 5], [42])
    const right = craftSid(1, 2, [0, 0, 0, 0, 0, 5], [42, 43])
    expect(sameSidAt(left, 0, right, 0)).toBe(false)
  })

  it('rejects an implausible subauthority count', () => {
    const left = craftSid(1, abi.SID_MAX_SUB_AUTHORITIES + 1)
    const right = craftSid(1, abi.SID_MAX_SUB_AUTHORITIES + 1)
    expect(sameSidAt(left, 0, right, 0)).toBe(false)
  })

  it('rejects a differing identifier authority byte', () => {
    const left = craftSid(1, 0, [0, 0, 0, 0, 0, 5])
    const right = craftSid(1, 0, [0, 0, 0, 0, 0, 6])
    expect(sameSidAt(left, 0, right, 0)).toBe(false)
  })

  it('accepts identical SIDs at nonzero offsets over differing leading bytes', () => {
    const sid = craftSid(1, 1, [0, 0, 0, 0, 0, 5], [42])
    // Embed the same SID bytes at offset 4 of two buffers whose first four
    // bytes differ: an offset-ignoring comparison reads the differing
    // prefixes and must reject.
    const left = allocBytes(4 + 12)
    const right = allocBytes(4 + 12)
    koffi.encode(left, 0, 'uint32', 0x11111111)
    koffi.encode(right, 0, 'uint32', 0x22222222)
    for (let offset = 0; offset < 12; offset++) {
      const byte = koffi.decode(sid, offset, 'uint8') as number
      koffi.encode(left, 4 + offset, 'uint8', byte)
      koffi.encode(right, 4 + offset, 'uint8', byte)
    }
    expect(sameSidAt(left, 4, right, 4)).toBe(true)
    expect(sameSidAt(left, 0, right, 0)).toBe(false) // the differing prefixes are not a matching SID
  })
})
