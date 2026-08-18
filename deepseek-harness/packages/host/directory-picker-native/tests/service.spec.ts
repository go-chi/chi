/** Registration/capability behavior of the native backend (the seam's cordis half). */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import NativeDirectoryPicker from '../src/index.ts'

describe('NativeDirectoryPicker', () => {
  it('registers ctx.directoryPicker with a stable native capability and leaves with its fiber', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin(NativeDirectoryPicker)
    await fiber.await()
    const picker = ctx.get('directoryPicker')
    expect(picker).toBeInstanceOf(NativeDirectoryPicker)
    const capability = picker!.capability()
    expect(capability.kind).toBe('native')
    // Stability: consumers may capture the capability object across calls.
    expect(picker!.capability()).toBe(capability)
    await fiber.dispose()
    expect(ctx.get('directoryPicker')).toBeUndefined()
  })
})
