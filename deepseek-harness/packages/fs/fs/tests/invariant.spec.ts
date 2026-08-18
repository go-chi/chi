import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { FsTargetKey, FsVersion } from '@deepseek-ai/dsh-fs'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import * as FsInvariant from '@deepseek-ai/dsh-fs/invariant'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(FsInvariant)
  return ctx
}

const target = (key = 'file:1', displayPath = 'file.txt'): FsTarget => ({
  targetKey: FsTargetKey(key),
  displayPath,
})

describe('filesystem invariants', () => {
  it('accepts decision and observation events with usable identities', async () => {
    const ctx = await setup()
    await expect(ctx.waterfall(
      ctx as never, 'fs/write-intent', target(), undefined,
      () => Promise.resolve(undefined),
    )).resolves.toBeUndefined()
    await expect(ctx.waterfall(
      ctx as never, 'fs/edit-intent', target(), undefined,
      () => Promise.resolve(undefined),
    )).resolves.toBeUndefined()
    expect(() => {
      ctx.emit('fs/observed', target(), { kind: 'present', version: FsVersion('v1') }, undefined)
    }).not.toThrow()
    expect(() => { ctx.emit('fs/observed', target(), { kind: 'absent' }, undefined) }).not.toThrow()
    expect(() => { ctx.emit('tools/change') }).not.toThrow()
  })

  it('rejects empty target and version identities', async () => {
    const ctx = await setup()
    expect(() => {
      ctx.emit('fs/observed', target(''), { kind: 'present', version: FsVersion('v1') }, undefined)
    })
      .toThrow(/targetKey must be non-empty/)
    expect(() => {
      ctx.emit('fs/observed', target('file:1', ''), { kind: 'present', version: FsVersion('v1') }, undefined)
    })
      .toThrow(/displayPath must be non-empty/)
    expect(() => {
      ctx.emit('fs/observed', target(), { kind: 'present', version: FsVersion('') }, undefined)
    }).toThrow(/present version must be non-empty/)
    expect(() => {
      ctx.emit('fs/observed', target(), { kind: 'unknown' } as never, undefined)
    }).toThrow(/kind must be present or absent/)
  })
})
