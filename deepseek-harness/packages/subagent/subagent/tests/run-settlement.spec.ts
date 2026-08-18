import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { settleRun } from '../src/index.ts'

describe('outcome mapping helpers', () => {
  it.each([
    ['completed', { status: 'completed', output: 'partial' }],
    ['aborted', { status: 'killed' }],
    ['error', { status: 'failed', detail: 'error' }],
    ['max-tokens', { status: 'failed', detail: 'max-tokens' }],
    ['refusal', { status: 'failed', detail: 'refusal' }],
    ['paused', { status: 'failed', detail: 'paused' }],
  ] as const)('settleRun maps the %s stop reason onto its Task outcome', async (stopReason, expected) => {
    const output = [{ type: 'text' as const, text: 'partial' }]
    await expect(settleRun({
      id: SessionId('child'),
      localAgent: undefined,
      result: Promise.resolve({ output, stopReason: stopReason as never }),
      dispose: () => Promise.resolve(),
    })).resolves.toEqual(expected)
  })

  it('settleRun disposes the run before reporting, on both result paths', async () => {
    const order: string[] = []
    const completed = await settleRun({
      id: SessionId('child-1'),
      localAgent: undefined,
      result: Promise.resolve({ output: [{ type: 'text' as const, text: 'ok' }], stopReason: 'completed' as const }),
      dispose() { order.push('dispose'); return Promise.resolve() },
    })
    order.push('reported')
    expect(completed).toEqual({ status: 'completed', output: 'ok' })
    expect(order).toEqual(['dispose', 'reported'])

    // An infrastructure rejection still disposes and reports failed.
    let disposed = false
    const failed = await settleRun({
      id: SessionId('child-2'),
      localAgent: undefined,
      result: Promise.reject(new Error('transport gone')),
      dispose() { disposed = true; return Promise.resolve() },
    })
    expect(failed).toEqual({ status: 'failed', detail: 'Error: transport gone' })
    expect(disposed).toBe(true)

    const disposeFailed = await settleRun({
      id: SessionId('child-4'),
      localAgent: undefined,
      result: Promise.resolve({ output: [], stopReason: 'completed' }),
      dispose: () => Promise.reject(new Error('reap failed')),
    })
    expect(disposeFailed).toEqual({ status: 'failed', detail: 'dispose failed: Error: reap failed' })

    const bothFailed = await settleRun({
      id: SessionId('child-5'),
      localAgent: undefined,
      result: Promise.reject(new Error('result failed')),
      dispose: () => Promise.reject(new Error('reap failed')),
    })
    expect(bothFailed).toEqual({
      status: 'failed',
      detail: 'Error: result failed; dispose failed: Error: reap failed',
    })
  })
})
