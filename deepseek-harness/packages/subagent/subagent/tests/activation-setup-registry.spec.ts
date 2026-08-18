import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SubagentActivationSetupRegistry from '../src/activation-setup-registry.ts'

/** A child-like scoped context with observable disposal. */
function childContext(): { ctx: Context; close: () => Promise<void> } {
  const root = new Context()
  const scope = root.plugin(function child() {})
  return { ctx: scope.ctx, close: async () => { await scope.dispose() } }
}

describe('SubagentActivationSetupRegistry', () => {
  it('installs contributions in registration order and commits them', () => {
    const registry = new SubagentActivationSetupRegistry()
    const order: string[] = []
    registry.register(() => { order.push('first'); return () => order.push('undo-first') })
    registry.register(() => { order.push('second'); return () => order.push('undo-second') })
    const child = childContext()

    const transaction = registry.apply(child.ctx)
    expect(order).toEqual(['first', 'second'])
    expect(() => { transaction.commit() }).not.toThrow()
    expect(order).toEqual(['first', 'second'])
  })

  it('makes repeated removal and converging ownership idempotent', async () => {
    const registry = new SubagentActivationSetupRegistry()
    let disposals = 0
    const remove = registry.register(() => () => { disposals += 1 })
    const child = childContext()
    registry.apply(child.ctx).commit()

    remove()
    remove()
    await child.close()
    expect(disposals).toBe(1)
  })

  it('makes the opposite ownership convergence idempotent', async () => {
    const registry = new SubagentActivationSetupRegistry()
    let disposals = 0
    const remove = registry.register(() => () => { disposals += 1 })
    const child = childContext()
    registry.apply(child.ctx).commit()

    await child.close()
    remove()
    expect(disposals).toBe(1)
  })

  it('skips a contribution removed before a child is applied', () => {
    const registry = new SubagentActivationSetupRegistry()
    const installed: string[] = []
    const remove = registry.register(() => { installed.push('gone'); return () => {} })
    registry.register(() => { installed.push('kept'); return () => {} })
    remove()

    registry.apply(childContext().ctx).commit()
    expect(installed).toEqual(['kept'])
  })

  it('invalidates a provisioning batch revoked before commit', () => {
    const registry = new SubagentActivationSetupRegistry()
    let disposals = 0
    const remove = registry.register(() => () => { disposals += 1 })
    const transaction = registry.apply(childContext().ctx)

    remove()
    expect(disposals).toBe(1)
    expect(() => { transaction.commit() }).toThrow(/revoked while this child was being built/)
  })

  it('catches a contribution revoked inside its own installer', () => {
    const registry = new SubagentActivationSetupRegistry()
    let disposals = 0
    const self: { remove?: () => void } = {}
    self.remove = registry.register(() => {
      self.remove?.()
      return () => { disposals += 1 }
    })

    const transaction = registry.apply(childContext().ctx)
    expect(disposals).toBe(1)
    expect(() => { transaction.commit() }).toThrow(/revoked/)
  })

  it('attempts every contribution-removal disposer before reporting failures', () => {
    const registry = new SubagentActivationSetupRegistry()
    const released: string[] = []
    let seq = 0
    const remove = registry.register(() => {
      const id = `child-${++seq}`
      return () => {
        released.push(id)
        if (id === 'child-1') throw new Error('disposer exploded')
      }
    })
    for (const child of [childContext(), childContext(), childContext()]) {
      registry.apply(child.ctx).commit()
    }

    expect(() => { remove() }).toThrow(/failed to release 1 installation\(s\)/)
    expect(released).toEqual(['child-1', 'child-2', 'child-3'])
  })

  it('attempts every child-scope disposer before reporting failures', async () => {
    const registry = new SubagentActivationSetupRegistry()
    const released: string[] = []
    registry.register(() => () => {
      released.push('a')
      throw new Error('first disposer exploded')
    })
    registry.register(() => () => { released.push('b') })
    const child = childContext()
    registry.apply(child.ctx).commit()

    await child.close().catch(() => undefined)
    expect(released).toEqual(['a', 'b'])
  })

  it('rolls back earlier installations when a later contribution throws', () => {
    const registry = new SubagentActivationSetupRegistry()
    const undone: string[] = []
    registry.register(() => () => undone.push('first'))
    registry.register(() => { throw new Error('boom') })
    registry.register(() => () => undone.push('third'))

    expect(() => registry.apply(childContext().ctx)).toThrow(/boom/)
    expect(undone).toEqual(['first'])
  })

  it('does not dispose twice when revocation precedes setup rollback', () => {
    const registry = new SubagentActivationSetupRegistry()
    const disposals: string[] = []
    const removeFirst = registry.register(() => () => { disposals.push('first') })
    registry.register(() => {
      removeFirst()
      throw new Error('second failed after revoking the first')
    })

    expect(() => registry.apply(childContext().ctx)).toThrow(/second failed/)
    expect(disposals).toEqual(['first'])
  })

  it('does not cross-release independent child scopes', async () => {
    const registry = new SubagentActivationSetupRegistry()
    const disposed: string[] = []
    let seq = 0
    registry.register(() => {
      const id = `child-${++seq}`
      return () => disposed.push(id)
    })
    const first = childContext()
    const second = childContext()
    registry.apply(first.ctx).commit()
    registry.apply(second.ctx).commit()

    await first.close()
    expect(disposed).toEqual(['child-1'])
    await second.close()
    expect(disposed).toEqual(['child-1', 'child-2'])
  })
})
