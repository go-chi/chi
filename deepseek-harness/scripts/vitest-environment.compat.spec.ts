// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

describe('Vitest jsdom compatibility', () => {
  it('provides isolated browser storage instead of Node process storage', () => {
    if (process.allowedNodeEnvironmentFlags.has('--webstorage')) {
      expect(process.execArgv.filter(argument => argument === '--no-webstorage')).toHaveLength(1)
    }
    localStorage.setItem('dsh-vitest-storage-probe', 'available')

    expect(localStorage.getItem('dsh-vitest-storage-probe')).toBe('available')
    localStorage.removeItem('dsh-vitest-storage-probe')
  })
})
