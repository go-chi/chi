import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolvedClientTimeZone } from '../src/client/time-zone.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('browser time zone', () => {
  it('returns the runtime-resolved zone', () => {
    expect(resolvedClientTimeZone()).toBe(
      new Intl.DateTimeFormat().resolvedOptions().timeZone,
    )
  })

  it.each([undefined, ''])('fails loud when the runtime exposes no zone %#', (timeZone) => {
    const options = new Intl.DateTimeFormat().resolvedOptions()
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      ...options,
      timeZone: timeZone as string,
    })

    expect(() => resolvedClientTimeZone()).toThrow('browser time zone is unavailable')
  })
})
