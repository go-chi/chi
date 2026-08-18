/** Node half: the empty host apply (Loader governance + dsh.client discovery placeholder). */
import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'

describe('node half', () => {
  it('apply is a no-op host placeholder', () => {
    apply(undefined)
    expect(true).toBe(true) // reaching here without throw is the contract
  })
})
