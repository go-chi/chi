import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import { createUserMessage, ProviderRequestId } from '@deepseek-ai/dsh-llm'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as RetryInvariant from '@deepseek-ai/dsh-llm-retry/invariant'
import { RetryId } from '@deepseek-ai/dsh-llm-retry'
import { providerForOpenStep } from '../src/history.ts'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(RetryInvariant)
  return ctx
}

function openStep(ctx: Context, id: string, turn = 1, step = 1) {
  const session = ctx.sessions.create(SessionId(id))
  session.append('turn/start', { turn })
  session.append('step/start', { turn, step })
  session.append('request/header', {
    header: { config: { provider: 'mock', model: 'mock' } },
    reason: 'initial',
  })
  return session
}

function appendRetryTurn(session: Session, turn: number) {
  session.append('turn/start', { turn })
  session.append('step/start', { turn, step: 1 })
  session.append('request/header', {
    header: { config: { provider: 'mock', model: 'mock' } },
    reason: 'initial',
  })
  session.append('llm/retry', { turn, step: 1, ...normal })
}

const failure = { message: 'provider busy', code: 'RATE_LIMIT', status: 429 }
const normal = {
  retryId: RetryId('normal-retry-chain'),
  provider: 'mock',
  mode: 'normal' as const,
  policyKey: 'normal-policy',
  retry: 1,
  maxRetries: 2,
  delayMs: 1,
  failure,
}
const always = {
  retryId: RetryId('always-retry-chain'),
  provider: 'mock',
  mode: 'always' as const,
  policyKey: 'always-policy',
  retry: 1,
  delayMs: 1,
  failure,
}

describe('llm-retry invariants', () => {
  it('has no provider without the requested open step or a route marker', () => {
    expect(providerForOpenStep([], 1, 1)).toBeUndefined()
    expect(providerForOpenStep([{
      type: 'step/start',
      data: { turn: 1, step: 1 },
    }] as never, 1, 1)).toBeUndefined()
  })

  it('accepts successive bounded and unbounded records inside their open steps', async () => {
    const ctx = await setup()
    const session = openStep(ctx, 'retry-invariant-valid')

    expect(() => {
      session.append('llm/retry', { turn: 1, step: 1, ...normal })
      session.append('llm/retry', {
        turn: 1, step: 1, ...normal, retry: 2, delayMs: 0,
      })
      const unbounded = openStep(ctx, 'retry-invariant-always')
      unbounded.append('llm/retry', { turn: 1, step: 1, ...always })
    }).not.toThrow()
    expect(() => { ctx.emit('tools/change') }).not.toThrow()
  })

  it('validates the complete durable failure payload', async () => {
    const ctx = await setup()
    const complete = openStep(ctx, 'retry-invariant-complete-failure')
    expect(() => {
      complete.append('llm/retry', {
        turn: 1,
        step: 1,
        ...always,
        failure: {
          message: 'provider busy',
          code: 'RATE_LIMIT',
          status: 429,
          providerRetryAfterMs: 25,
          requestId: ProviderRequestId('request-1'),
        },
      })
    }).not.toThrow()

    const invalidFailures: readonly [string, unknown, RegExp][] = [
      ['null', null, /failure must be an object/],
      ['message-type', { message: 1, code: 'RATE_LIMIT' }, /failure\.message/],
      ['message-empty', { message: '', code: 'RATE_LIMIT' }, /failure\.message/],
      ['code-type', { message: 'failed', code: 1 }, /failure\.code/],
      ['code-empty', { message: 'failed', code: '' }, /failure\.code/],
      ['status-type', { message: 'failed', code: 'RATE_LIMIT', status: 429.5 }, /failure\.status/],
      ['status-low', { message: 'failed', code: 'RATE_LIMIT', status: 99 }, /failure\.status/],
      ['status-high', { message: 'failed', code: 'RATE_LIMIT', status: 600 }, /failure\.status/],
      [
        'retry-after-type',
        { message: 'failed', code: 'RATE_LIMIT', providerRetryAfterMs: '25' },
        /failure\.providerRetryAfterMs/,
      ],
      [
        'retry-after-zero',
        { message: 'failed', code: 'RATE_LIMIT', providerRetryAfterMs: 0 },
        /failure\.providerRetryAfterMs/,
      ],
      ['request-id-type', { message: 'failed', code: 'RATE_LIMIT', requestId: 1 }, /failure\.requestId/],
      ['request-id-empty', { message: 'failed', code: 'RATE_LIMIT', requestId: '' }, /failure\.requestId/],
    ]
    for (const [name, invalidFailure, message] of invalidFailures) {
      const session = openStep(ctx, `retry-invariant-failure-${name}`)
      expect(() => {
        session.append('llm/retry', {
          turn: 1, step: 1, ...always, failure: invalidFailure,
        } as never)
      }).toThrow(message)
    }
  })

  it.each([
    ['empty-retry-id', { ...normal, retryId: RetryId('') }, /retryId must be a non-empty string/],
    ['retry-zero', { ...normal, retry: 0 }, /positive safe integer/],
    ['retry-fraction', { ...normal, retry: 1.5 }, /positive safe integer/],
    ['max-zero', { ...normal, maxRetries: 0 }, /positive safe maxRetries/],
    ['max-fraction', { ...normal, maxRetries: 1.5 }, /positive safe maxRetries/],
    ['over-budget', { ...normal, retry: 3 }, /must not exceed/],
    ['always-maximum', { ...always, maxRetries: 2 }, /always mode must omit maxRetries/],
    ['unknown-mode', { ...always, mode: 'sometimes' }, /mode must be normal or always/],
    ['empty-provider', { ...always, provider: '' }, /provider must be a non-empty string/],
    ['empty-policy-key', { ...always, policyKey: '' }, /policyKey must be a non-empty string/],
    ['delay-negative', { ...normal, delayMs: -1 }, /delayMs/],
    ['delay-overflow', { ...normal, delayMs: MAX_TIMER_DELAY_MS + 1 }, /delayMs/],
    ['delay-type', { ...normal, delayMs: '1' }, /delayMs/],
  ])('rejects invalid retry data: %s', async (name, data, message) => {
    const ctx = await setup()
    const session = openStep(ctx, `retry-invariant-${name}`)
    expect(() => {
      session.append('llm/retry', { turn: 1, step: 1, ...data } as never)
    }).toThrow(message)
  })

  it('rejects records outside the currently open turn and step', async () => {
    const ctx = await setup()
    const absent = ctx.sessions.create(SessionId('retry-invariant-no-turn'))
    expect(() => {
      absent.append('llm/retry', { turn: 1, step: 1, ...normal })
    }).toThrow(/inside an open turn/)

    const wrongTurn = openStep(ctx, 'retry-invariant-wrong-turn')
    expect(() => {
      wrongTurn.append('llm/retry', { turn: 2, step: 1, ...normal })
    }).toThrow(/open turn is 1/)

    const closedStep = openStep(ctx, 'retry-invariant-closed-step')
    closedStep.append('step/end', { turn: 1, step: 1 })
    expect(() => {
      closedStep.append('llm/retry', { turn: 1, step: 1, ...normal })
    }).toThrow(/inside an open step/)

    const noStep = ctx.sessions.create(SessionId('retry-invariant-no-step'))
    noStep.append('turn/start', { turn: 1 })
    expect(() => {
      noStep.append('llm/retry', { turn: 1, step: 1, ...normal })
    }).toThrow(/inside an open step/)

    const wrongStep = openStep(ctx, 'retry-invariant-wrong-step')
    expect(() => {
      wrongStep.append('llm/retry', { turn: 1, step: 2, ...normal })
    }).toThrow(/open step is 1\/1/)

    const closedTurn = openStep(ctx, 'retry-invariant-closed-turn')
    closedTurn.append('step/end', { turn: 1, step: 1 })
    closedTurn.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } },
    })
    expect(() => {
      closedTurn.append('llm/retry', { turn: 1, step: 1, ...normal })
    }).toThrow(/inside an open turn/)
  })

  it('accepts successive retries in one step and rejects skipped numbering', async () => {
    const ctx = await setup()
    const session = openStep(ctx, 'retry-invariant-number-sequence')
    session.append('llm/retry', { turn: 1, step: 1, ...normal })
    session.append('llm/retry', { turn: 1, step: 1, ...normal, retry: 2 })

    expect(() => {
      session.append('llm/retry', { turn: 1, step: 1, ...always, retry: 2 })
    }).toThrow(/must equal provider policy retry 1/)
  })

  it('binds retry numbering to the provider policy and resets it for a new step', async () => {
    const ctx = await setup()
    const mismatch = openStep(ctx, 'retry-invariant-numbering')
    mismatch.append('llm/retry', { turn: 1, step: 1, ...normal })
    expect(() => {
      mismatch.append('llm/retry', { turn: 1, step: 1, ...normal, retry: 1 })
    }).toThrow(/must equal provider policy retry 2/)

    const reset = openStep(ctx, 'retry-invariant-reset')
    reset.append('llm/retry', { turn: 1, step: 1, ...normal })
    reset.append('step/end', { turn: 1, step: 1 })
    reset.append('step/start', { turn: 1, step: 2 })
    expect(() => {
      reset.append('llm/retry', {
        turn: 1,
        step: 2,
        ...normal,
        retryId: RetryId('reset-step-2-retry-chain'),
      })
    }).not.toThrow()
  })

  it('keeps one retry identity per provider-policy chain', async () => {
    const ctx = await setup()
    const changed = openStep(ctx, 'retry-invariant-changed-chain-id')
    changed.append('llm/retry', { turn: 1, step: 1, ...normal })
    expect(() => changed.append('llm/retry', {
      turn: 1,
      step: 1,
      ...normal,
      retry: 2,
      retryId: RetryId('changed-retry-chain'),
    })).toThrow(/must preserve retryId/)

    const reused = openStep(ctx, 'retry-invariant-reused-chain-id')
    reused.append('llm/retry', { turn: 1, step: 1, ...normal })
    expect(() => reused.append('llm/retry', {
      turn: 1,
      step: 1,
      ...always,
      retryId: normal.retryId,
    })).toThrow(/already owned by another chain/)
  })

  it('validates retry-started correlation and uniqueness', async () => {
    const ctx = await setup()
    const empty = openStep(ctx, 'retry-started-empty-id')
    expect(() => empty.append('llm/retry-started', {
      retryId: RetryId(''), turn: 1, step: 1, retry: 1,
    })).toThrow(/retryId must be a non-empty string/)

    const missing = openStep(ctx, 'retry-started-missing-schedule')
    expect(() => missing.append('llm/retry-started', {
      retryId: RetryId('missing-retry-chain'), turn: 1, step: 1, retry: 1,
    })).toThrow(/pairs no prior scheduled attempt/)

    const mismatch = openStep(ctx, 'retry-started-location-mismatch')
    mismatch.append('llm/retry', { turn: 1, step: 1, ...normal })
    expect(() => mismatch.append('llm/retry-started', {
      retryId: normal.retryId, turn: 2, step: 1, retry: 1,
    })).toThrow(/turn\/step must match/)

    const repeated = openStep(ctx, 'retry-started-repeated')
    repeated.append('llm/retry', { turn: 1, step: 1, ...normal })
    repeated.append('llm/retry-started', {
      retryId: normal.retryId, turn: 1, step: 1, retry: 1,
    })
    expect(() => repeated.append('llm/retry-started', {
      retryId: normal.retryId, turn: 1, step: 1, retry: 1,
    })).toThrow(/repeats one scheduled attempt/)
  })

  it('starts a fresh retry chain after incomplete predecessor boundaries', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)

    const missingEnd = ctx.sessions.create(SessionId('retry-invariant-missing-end'))
    missingEnd.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'idle context' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    appendRetryTurn(missingEnd, 2)

    const nonFailureEnd = ctx.sessions.create(SessionId('retry-invariant-non-failure-end'))
    nonFailureEnd.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    nonFailureEnd.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'idle context' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    appendRetryTurn(nonFailureEnd, 2)

    const missingStart = ctx.sessions.create(SessionId('retry-invariant-missing-start'))
    missingStart.append('turn/end', { turn: 1, reason: { kind: 'error', error: failure },
    })
    appendRetryTurn(missingStart, 2)

    await ctx.plugin(InvariantRegistry)
    await expect(ctx.plugin(RetryInvariant)).resolves.toBeDefined()
  })

  it('rejects a provider that does not match the failed request route', async () => {
    const ctx = await setup()
    const session = openStep(ctx, 'retry-invariant-provider')
    expect(() => {
      session.append('llm/retry', { turn: 1, step: 1, ...always, provider: 'other' })
    }).toThrow(/does not match the failed request provider mock/)
  })

  it('validates existing histories on late registration', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('retry-invariant-late'))
    session.append('step/start', { turn: 1, step: 1 })
    session.append('llm/retry', { turn: 1, step: 1, ...normal })
    await ctx.plugin(InvariantRegistry)
    await expect(ctx.plugin(RetryInvariant)).rejects.toThrow(/inside an open turn/)
  })

  it('accepts a scheduled and started attempt on late registration', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = openStep(ctx, 'retry-invariant-late-started')
    session.append('llm/retry', { turn: 1, step: 1, ...normal })
    session.append('llm/retry-started', {
      retryId: normal.retryId, turn: 1, step: 1, retry: 1,
    })
    await ctx.plugin(InvariantRegistry)
    await expect(ctx.plugin(RetryInvariant)).resolves.toBeDefined()
  })
})
