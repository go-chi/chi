/** Contract behavior the seam itself owns: registration identity and typed failures. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { DirectoryPicker, DirectoryPickerError } from '../src/index.ts'
import type { DirectoryPickerCapability } from '../src/index.ts'

/** Minimal concrete backend: all a subclass owes the abstract class is capability(). */
class StubPicker extends DirectoryPicker {
  private readonly stub: DirectoryPickerCapability = { kind: 'native', pick: async () => null }
  capability(): DirectoryPickerCapability {
    return this.stub
  }
}

describe('DirectoryPicker seam', () => {
  it('registers a subclass as ctx.directoryPicker and leaves with its fiber', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin(StubPicker)
    await fiber.await()
    expect(ctx.get('directoryPicker')).toBeInstanceOf(StubPicker)
    expect(ctx.get('directoryPicker')!.capability().kind).toBe('native')
    await fiber.dispose()
    expect(ctx.get('directoryPicker')).toBeUndefined()
  })

  it('carries the business code and subject path on DirectoryPickerError', () => {
    const failure = new DirectoryPickerError('directory-exists', '/home/u/x', '/home/u/x already exists')
    expect(failure.name).toBe('DirectoryPickerError')
    expect(failure.code).toBe('directory-exists')
    expect(failure.path).toBe('/home/u/x')
    expect(failure.message).toContain('already exists')
    expect(failure).toBeInstanceOf(Error)
  })
})
