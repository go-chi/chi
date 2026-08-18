/**
 * InputMachine unit account: the submit
 * plane (adjudication, span CAS, drift
 * guard, anti-backwash), plus the occurrence table (shift / whole-chip
 * deletion / same-name independence), the self-managed undo log (typing
 * coalescing, paste two-stage undo, redo chain), consume-token guards, the
 * paste attempt lifecycle, projectClipboard, and the decoration projection.
 * Pure event sequences — no React, no DOM, no ambient clock.
 */
import { describe, expect, it } from 'vitest'
import type { CommandClaim, ReferenceInsert, TokenSpan } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { InputEffect, SubmitAttempt } from '../src/client/input/contract.ts'
import { InputMachine, PLACEHOLDER, projectClipboard } from '../src/client/input/machine.ts'
import { deriveDecorations, scanTextRefs } from '../src/client/input/decorations.ts'

const P = PLACEHOLDER

function claimOf(name: string, hint?: string): CommandClaim {
  return {
    token: `/${name} `,
    ...(hint !== undefined ? { hint } : {}),
    submit: async () => ({ kind: 'success' }),
  }
}

function refOf(name: string, source = 'skill'): ReferenceInsert {
  return { source, ref: name, label: name, clipboardText: `/${name}` }
}

function spanOf(m: InputMachine, start: number, end: number): TokenSpan {
  return { start, end, draftRev: m.state.draftRev }
}

function effectAt<T extends InputEffect['type']>(
  effects: readonly InputEffect[], index: number, type: T,
): Extract<InputEffect, { type: T }> {
  const e = effects[index]
  expect(e?.type).toBe(type)
  return e as Extract<InputEffect, { type: T }>
}

/** Drive plain → adjudicating and hand back the minted attempt. */
function enterAdjudicating(m: InputMachine, draft: string, mode: 'queue' | 'steer' = 'queue'): SubmitAttempt {
  m.dispatch({ type: 'draft-changed', draft })
  const fx = m.dispatch({ type: 'enter', mode })
  return effectAt(fx, 0, 'adjudicate').attempt
}

/** Drive plain → claimed → submitting and hand back attempt + claim. */
function enterSubmitting(m: InputMachine, name: string, args: string): { attempt: SubmitAttempt; claim: CommandClaim } {
  const claim = claimOf(name)
  m.dispatch({ type: 'draft-changed', draft: `/${name.slice(0, 2)}` })
  m.dispatch({ type: 'begin-command', claim, span: spanOf(m, 0, m.state.draft.length) })
  m.dispatch({ type: 'draft-changed', draft: claim.token + args })
  const fx = m.dispatch({ type: 'enter', mode: 'queue' })
  return { attempt: effectAt(fx, 0, 'begin-submit').attempt, claim }
}

function staleAttempt(): SubmitAttempt {
  return { seq: 9999, signal: new AbortController().signal, draftSnapshot: '', mode: 'queue' }
}

describe('input-machine: plain × enter', () => {
  it('empty and whitespace-only drafts produce nothing', () => {
    const m = new InputMachine()
    expect(m.dispatch({ type: 'enter', mode: 'queue' })).toEqual([])
    m.dispatch({ type: 'draft-changed', draft: '  \n ' })
    expect(m.dispatch({ type: 'enter', mode: 'queue' })).toEqual([])
    expect(m.state.phase).toBe('plain')
  })

  it('non-command text falls to the default sink', () => {
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: 'hello world' })
    expect(m.dispatch({ type: 'enter', mode: 'queue' }))
      .toEqual([{ type: 'default-sink', draft: 'hello world', mode: 'queue' }])
    expect(m.state.phase).toBe('plain')
  })

  it('retains an explicit steer mode on the default sink effect', () => {
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: 'steer now' })
    expect(m.dispatch({ type: 'enter', mode: 'steer' }))
      .toEqual([{ type: 'default-sink', draft: 'steer now', mode: 'steer' }])
  })

  it('leading "/" enters adjudicating with a minted attempt carrying the draft snapshot', () => {
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: '/goal x' })
    const fx = m.dispatch({ type: 'enter', mode: 'queue' })
    const eff = effectAt(fx, 0, 'adjudicate')
    expect(eff.draft).toBe('/goal x')
    expect(eff.attempt.draftSnapshot).toBe('/goal x')
    expect(eff.attempt.signal.aborted).toBe(false)
    expect(m.state.phase).toBe('adjudicating')
  })

  it('leading is judged after trim including newlines', () => {
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: '\n\n/goal x' })
    expect(m.dispatch({ type: 'enter', mode: 'queue' })[0]?.type).toBe('adjudicate')
  })

  it('a non-whitespace prefix before "/" is not leading — default sink', () => {
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: '第一行\n/goal x' })
    expect(m.dispatch({ type: 'enter', mode: 'queue' }))
      .toEqual([{ type: 'default-sink', draft: '第一行\n/goal x', mode: 'queue' }])
  })
})

describe('input-machine: adjudication outcomes', () => {
  it('{claim} moves to submitting; args split on the first whitespace, newlines kept', () => {
    const m = new InputMachine()
    const attempt = enterAdjudicating(m, '/goal x\ny')
    const fx = m.dispatch({ type: 'adjudicated', attempt, outcome: { claim: claimOf('goal') } })
    const eff = effectAt(fx, 0, 'begin-submit')
    expect(eff.args).toBe('x\ny')
    expect(eff.attempt.seq).toBe(attempt.seq)
    expect(m.state.phase).toBe('submitting')
    expect(m.state.claim).toEqual({ token: '/goal ' })
  })

  it('bare "/goal" claim yields empty args; leading whitespace snapshot yields trimmed args', () => {
    const a = new InputMachine()
    const attemptA = enterAdjudicating(a, '/goal')
    expect(effectAt(a.dispatch({ type: 'adjudicated', attempt: attemptA, outcome: { claim: claimOf('goal') } }), 0, 'begin-submit').args).toBe('')

    const b = new InputMachine()
    const attemptB = enterAdjudicating(b, '\n\n/goal x')
    expect(effectAt(b.dispatch({ type: 'adjudicated', attempt: attemptB, outcome: { claim: claimOf('goal') } }), 0, 'begin-submit').args).toBe('x')
  })

  it('undefined outcome falls back to the default sink', () => {
    const m = new InputMachine()
    const attempt = enterAdjudicating(m, '/unknown thing', 'steer')
    expect(m.dispatch({ type: 'adjudicated', attempt, outcome: undefined }))
      .toEqual([{ type: 'default-sink', draft: '/unknown thing', mode: 'steer' }])
    expect(m.state.phase).toBe('plain')
  })

  it("'handled' lands plain with zero effects (popup shell path)", () => {
    const m = new InputMachine()
    const attempt = enterAdjudicating(m, '/model')
    expect(m.dispatch({ type: 'adjudicated', attempt, outcome: 'handled' })).toEqual([])
    expect(m.state.phase).toBe('plain')
    expect(m.state.draft).toBe('/model')
  })

  it('adjudication failure notices and keeps the draft — no silent downgrade', () => {
    const m = new InputMachine()
    const attempt = enterAdjudicating(m, '/goal x')
    expect(m.dispatch({ type: 'adjudication-failed', attempt, message: 'warmup failed' }))
      .toEqual([{ type: 'notice', level: 'error', text: 'warmup failed' }])
    expect(m.state.phase).toBe('plain')
    expect(m.state.draft).toBe('/goal x')
  })

  it('enter is a no-op while adjudicating (pending lock)', () => {
    const m = new InputMachine()
    enterAdjudicating(m, '/goal x')
    expect(m.dispatch({ type: 'enter', mode: 'queue' })).toEqual([])
    expect(m.state.phase).toBe('adjudicating')
  })

  it('a stale attempt on adjudicated/adjudication-failed is dropped: same state, zero effects', () => {
    const m = new InputMachine()
    enterAdjudicating(m, '/goal x')
    expect(m.dispatch({ type: 'adjudicated', attempt: staleAttempt(), outcome: { claim: claimOf('goal') } })).toEqual([])
    expect(m.dispatch({ type: 'adjudication-failed', attempt: staleAttempt(), message: 'x' })).toEqual([])
    expect(m.state.phase).toBe('adjudicating')
  })

  it('an adjudicated result arriving after release is dropped (anti-backwash)', () => {
    const m = new InputMachine()
    const attempt = enterAdjudicating(m, '/goal x')
    m.dispatch({ type: 'release' })
    expect(m.dispatch({ type: 'adjudicated', attempt, outcome: { claim: claimOf('goal') } })).toEqual([])
    expect(m.state.phase).toBe('plain')
  })
})

describe('input-machine: begin-command CAS', () => {
  it('valid span replaces it with the token and enters claimed; success = draftRev advance', () => {
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: '/go' })
    const before = m.state.draftRev
    const fx = m.dispatch({ type: 'begin-command', claim: claimOf('goal', 'objective'), span: spanOf(m, 0, 3) })
    expect(fx).toEqual([])
    expect(m.state.draftRev).toBeGreaterThan(before)
    expect(m.state.draft).toBe('/goal ')
    expect(m.state.phase).toBe('claimed')
    expect(m.state.claim).toEqual({ token: '/goal ', hint: 'objective' })
  })

  it('a leading-whitespace prefix is dropped so the startsWith watch holds', () => {
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: '\n\n/go' })
    m.dispatch({ type: 'begin-command', claim: claimOf('goal'), span: spanOf(m, 2, 5) })
    expect(m.state.draft).toBe('/goal ')
    m.dispatch({ type: 'draft-changed', draft: '/goal x' })
    expect(m.state.phase).toBe('claimed')
  })

  it('a stale draftRev no-ops the whole action — no state change, no revision bump', () => {
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: '/go' })
    const span = spanOf(m, 0, 3)
    m.dispatch({ type: 'draft-changed', draft: '/goX' })
    const rev = m.state.draftRev
    expect(m.dispatch({ type: 'begin-command', claim: claimOf('goal'), span })).toEqual([])
    expect(m.state).toMatchObject({ phase: 'plain', draft: '/goX', draftRev: rev })
  })

  it('a non-whitespace prefix before the span no-ops (leading-trigger contract)', () => {
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: 'x /go' })
    expect(m.dispatch({ type: 'begin-command', claim: claimOf('goal'), span: spanOf(m, 2, 5) })).toEqual([])
    expect(m.state.phase).toBe('plain')
  })

  it('claimed overwrites in place — no stack', () => {
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: '/go' })
    m.dispatch({ type: 'begin-command', claim: claimOf('goal'), span: spanOf(m, 0, 3) })
    m.dispatch({ type: 'begin-command', claim: claimOf('model'), span: spanOf(m, 0, 6) })
    expect(m.state.draft).toBe('/model ')
    expect(m.state.claim?.token).toBe('/model ')
    expect(m.state.phase).toBe('claimed')
  })

  it('submitting rejects begin-command (lock)', () => {
    const m = new InputMachine()
    enterSubmitting(m, 'goal', 'x')
    expect(m.dispatch({ type: 'begin-command', claim: claimOf('model'), span: spanOf(m, 0, 6) })).toEqual([])
    expect(m.state.claim?.token).toBe('/goal ')
    expect(m.state.phase).toBe('submitting')
  })

  it('undo reverts the claim transaction and the watch releases the claim', () => {
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: '/go' })
    m.dispatch({ type: 'begin-command', claim: claimOf('goal'), span: spanOf(m, 0, 3) })
    m.dispatch({ type: 'undo' })
    expect(m.state).toMatchObject({ draft: '/go', phase: 'plain' })
    expect(m.state.claim).toBeUndefined()
  })
})

describe('input-machine: insert-ref and the occurrence table', () => {
  it('valid span becomes one placeholder + one occurrence with cached projections', () => {
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: 'see @wor now' })
    const fx = m.dispatch({ type: 'insert-ref', reference: refOf('worker-1', 'subagent'), span: spanOf(m, 4, 8) })
    expect(fx).toEqual([])
    expect(m.state.draft).toBe(`see ${P} now`)
    expect(m.state.occurrences).toEqual([{
      occurrenceId: 1, source: 'subagent', ref: 'worker-1', offset: 4,
      label: 'worker-1', clipboardText: '/worker-1',
    }])
    expect(m.state.phase).toBe('plain')
  })

  it('same-named references stay independent: distinct occurrenceIds, one deletion leaves the other', () => {
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: '/alp' })
    m.dispatch({ type: 'insert-ref', reference: refOf('alpha'), span: spanOf(m, 0, 4) })
    m.dispatch({ type: 'draft-changed', draft: `${P} and /alp`, editRange: { start: 1, end: 1, insertedLength: 9 } })
    m.dispatch({ type: 'insert-ref', reference: refOf('alpha'), span: spanOf(m, 6, 10) })
    expect(m.state.draft).toBe(`${P} and ${P} `)
    expect(m.state.occurrences.map(o => o.occurrenceId)).toEqual([1, 2])
    // Delete the first chip whole; the second survives with its own identity.
    m.dispatch({ type: 'draft-changed', draft: ` and ${P} `, editRange: { start: 0, end: 1, insertedLength: 0 } })
    expect(m.state.occurrences).toEqual([expect.objectContaining({ occurrenceId: 2, offset: 5 })])
  })

  it('claimed stays claimed across an inline insert (inline "@" during command args)', () => {
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: '/go' })
    m.dispatch({ type: 'begin-command', claim: claimOf('goal'), span: spanOf(m, 0, 3) })
    m.dispatch({ type: 'draft-changed', draft: '/goal ask @wor' })
    m.dispatch({ type: 'insert-ref', reference: refOf('worker-1', 'subagent'), span: spanOf(m, 10, 14) })
    expect(m.state.draft).toBe(`/goal ask ${P} `)
    expect(m.state.phase).toBe('claimed')
    expect(m.state.occurrences).toHaveLength(1)
  })

  it('a stale draftRev no-ops: no draft change, no occurrence', () => {
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: 'see @wor' })
    const span = spanOf(m, 4, 8)
    m.dispatch({ type: 'draft-changed', draft: 'see @work' })
    expect(m.dispatch({ type: 'insert-ref', reference: refOf('w'), span })).toEqual([])
    expect(m.state.occurrences).toEqual([])
  })
})

describe('input-machine: occurrence reconciliation on draft edits', () => {
  /** Machine with one chip at offset 4 inside `see ${P} now`. */
  function withChip(): InputMachine {
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: 'see @wor now' })
    m.dispatch({ type: 'insert-ref', reference: refOf('worker-1', 'subagent'), span: spanOf(m, 4, 8) })
    return m
  }

  it('an edit before the placeholder shifts the offset by the length delta (explicit editRange)', () => {
    const m = withChip()
    m.dispatch({ type: 'draft-changed', draft: `I see ${P} now`, editRange: { start: 0, end: 0, insertedLength: 2 } })
    expect(m.state.occurrences[0]?.offset).toBe(6)
    m.dispatch({ type: 'draft-changed', draft: `see ${P} now`, editRange: { start: 0, end: 2, insertedLength: 0 } })
    expect(m.state.occurrences[0]?.offset).toBe(4)
  })

  it('an edit after the placeholder leaves the offset alone', () => {
    const m = withChip()
    m.dispatch({ type: 'draft-changed', draft: `see ${P} later`, editRange: { start: 6, end: 9, insertedLength: 5 } })
    expect(m.state.occurrences[0]?.offset).toBe(4)
  })

  it('a deletion covering the placeholder removes the whole occurrence', () => {
    const m = withChip()
    m.dispatch({ type: 'draft-changed', draft: 'see  now', editRange: { start: 4, end: 5, insertedLength: 0 } })
    expect(m.state.occurrences).toEqual([])
    expect(m.state.draft).toBe('see  now')
  })

  it('a replacement spanning the placeholder removes the occurrence and keeps the replacement text', () => {
    const m = withChip()
    m.dispatch({ type: 'draft-changed', draft: 'see all of it now', editRange: { start: 4, end: 5, insertedLength: 9 } })
    expect(m.state.occurrences).toEqual([])
  })

  it('without editRange the prefix/suffix diff scan recovers the edit (shift path)', () => {
    const m = withChip()
    m.dispatch({ type: 'draft-changed', draft: `see there ${P} now` })
    expect(m.state.occurrences[0]?.offset).toBe(10)
  })

  it('without editRange the diff scan detects placeholder deletion', () => {
    const m = withChip()
    m.dispatch({ type: 'draft-changed', draft: 'see now' })
    expect(m.state.occurrences).toEqual([])
  })

  it('an identical draft is a no-op: no revision bump, no undo entry', () => {
    const m = withChip()
    const rev = m.state.draftRev
    expect(m.dispatch({ type: 'draft-changed', draft: m.state.draft })).toEqual([])
    expect(m.state.draftRev).toBe(rev)
  })
})

describe('input-machine: consume-token guards', () => {
  it('span guard: CAS pass deletes the token — success observable as a draftRev advance', () => {
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: '/model rest' })
    const before = m.state.draftRev
    m.dispatch({ type: 'consume-token', guard: { kind: 'span', span: spanOf(m, 0, 7) } })
    expect(m.state.draftRev).toBeGreaterThan(before)
    expect(m.state.draft).toBe('rest')
    m.dispatch({ type: 'undo' })
    expect(m.state.draft).toBe('/model rest')
  })

  it('span guard: a stale draftRev refuses — no deletion, no revision bump', () => {
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: '/model' })
    const span = spanOf(m, 0, 6)
    m.dispatch({ type: 'draft-changed', draft: '/model x' })
    const rev = m.state.draftRev
    expect(m.dispatch({ type: 'consume-token', guard: { kind: 'span', span } })).toEqual([])
    expect(m.state).toMatchObject({ draft: '/model x', draftRev: rev })
  })

  it('bare-token guard: trimmed equality clears the draft; mismatch refuses', () => {
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: '  /model \n' })
    m.dispatch({ type: 'consume-token', guard: { kind: 'bare-token', token: '/model' } })
    expect(m.state.draft).toBe('')
    m.dispatch({ type: 'undo' })
    expect(m.state.draft).toBe('  /model \n')

    m.dispatch({ type: 'draft-changed', draft: '/model extra' })
    const rev = m.state.draftRev
    expect(m.dispatch({ type: 'consume-token', guard: { kind: 'bare-token', token: '/model' } })).toEqual([])
    expect(m.state).toMatchObject({ draft: '/model extra', draftRev: rev })
  })

  it('a chip elsewhere in the draft shifts across a span consume', () => {
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: '/model @wor' })
    m.dispatch({ type: 'insert-ref', reference: refOf('w'), span: spanOf(m, 7, 11) })
    m.dispatch({ type: 'consume-token', guard: { kind: 'span', span: spanOf(m, 0, 7) } })
    expect(m.state.draft).toBe(`${P} `)
    expect(m.state.occurrences[0]?.offset).toBe(0)
  })
})

describe('input-machine: undo / redo', () => {
  it('the default constant clock coalesces contiguous single-char typing into one transaction', () => {
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: 'a', editRange: { start: 0, end: 0, insertedLength: 1 } })
    m.dispatch({ type: 'draft-changed', draft: 'ab', editRange: { start: 1, end: 1, insertedLength: 1 } })
    m.dispatch({ type: 'draft-changed', draft: 'abc', editRange: { start: 2, end: 2, insertedLength: 1 } })
    m.dispatch({ type: 'undo' })
    expect(m.state.draft).toBe('')
    m.dispatch({ type: 'redo' })
    expect(m.state.draft).toBe('abc')
  })

  it('the merge window splits typing runs: within merges, beyond opens a new transaction', () => {
    let t = 0
    const m = new InputMachine({ mergeWindowMs: 1000, now: () => t })
    m.dispatch({ type: 'draft-changed', draft: 'a', editRange: { start: 0, end: 0, insertedLength: 1 } })
    t = 900
    m.dispatch({ type: 'draft-changed', draft: 'ab', editRange: { start: 1, end: 1, insertedLength: 1 } })
    t = 2500 // beyond the window from the previous char
    m.dispatch({ type: 'draft-changed', draft: 'abc', editRange: { start: 2, end: 2, insertedLength: 1 } })
    m.dispatch({ type: 'undo' })
    expect(m.state.draft).toBe('ab')
    m.dispatch({ type: 'undo' })
    expect(m.state.draft).toBe('')
  })

  it('non-contiguous or multi-char edits never merge into a typing run', () => {
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: 'a', editRange: { start: 0, end: 0, insertedLength: 1 } })
    m.dispatch({ type: 'draft-changed', draft: 'ba', editRange: { start: 0, end: 0, insertedLength: 1 } })
    m.dispatch({ type: 'draft-changed', draft: 'baXY', editRange: { start: 2, end: 2, insertedLength: 2 } })
    m.dispatch({ type: 'undo' })
    expect(m.state.draft).toBe('ba')
    m.dispatch({ type: 'undo' })
    expect(m.state.draft).toBe('a')
    m.dispatch({ type: 'undo' })
    expect(m.state.draft).toBe('')
  })

  it('a new transaction cuts the redo chain', () => {
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: 'a', editRange: { start: 0, end: 0, insertedLength: 1 } })
    m.dispatch({ type: 'undo' })
    m.dispatch({ type: 'draft-changed', draft: 'z', editRange: { start: 0, end: 0, insertedLength: 1 } })
    expect(m.dispatch({ type: 'redo' })).toEqual([])
    expect(m.state.draft).toBe('z')
  })

  it('undo on an empty log and redo on an empty chain are no-ops', () => {
    const m = new InputMachine()
    expect(m.dispatch({ type: 'undo' })).toEqual([])
    expect(m.dispatch({ type: 'redo' })).toEqual([])
  })

  it('the log ring caps at 100 transactions', () => {
    let t = 0
    const m = new InputMachine({ mergeWindowMs: 0, now: () => (t += 10) })
    let draft = ''
    for (let i = 0; i < 110; i += 1) {
      draft += 'x'
      m.dispatch({ type: 'draft-changed', draft, editRange: { start: i, end: i, insertedLength: 1 } })
    }
    for (let i = 0; i < 100; i += 1) m.dispatch({ type: 'undo' })
    expect(m.state.draft).toBe('x'.repeat(10))
    expect(m.dispatch({ type: 'undo' })).toEqual([])
    expect(m.state.draft).toBe('x'.repeat(10))
  })

  it('undo restores the occurrence table with the draft (chip resurrection)', () => {
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: '@wor' })
    m.dispatch({ type: 'insert-ref', reference: refOf('w'), span: spanOf(m, 0, 4) })
    m.dispatch({ type: 'draft-changed', draft: '', editRange: { start: 0, end: 1, insertedLength: 0 } })
    expect(m.state.occurrences).toEqual([])
    m.dispatch({ type: 'undo' })
    expect(m.state.draft).toBe(`${P} `)
    expect(m.state.occurrences).toHaveLength(1)
  })

  it('a committed submit clears the log: undo cannot resurrect sent content', () => {
    const m = new InputMachine()
    const { attempt } = enterSubmitting(m, 'goal', 'x')
    m.dispatch({ type: 'submit-settled', attempt, ok: true })
    expect(m.state.draft).toBe('')
    expect(m.dispatch({ type: 'undo' })).toEqual([])
    expect(m.state.draft).toBe('')
  })
})

describe('input-machine: paste plane', () => {
  it('paste replaces the selection as one transaction and opens a match attempt', () => {
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: 'abc' })
    m.dispatch({ type: 'paste-begin', text: 'XY', selection: { start: 1, end: 2 }, generation: 7 })
    expect(m.state.draft).toBe('aXYc')
    expect(m.state.paste).toEqual({ attemptId: 1, insertedRange: { start: 1, end: 3 }, generation: 7 })
    m.dispatch({ type: 'undo' })
    expect(m.state.draft).toBe('abc')
  })

  it('pasted text is sanitized: raw U+FFFC never enters the draft as a fake chip', () => {
    const m = new InputMachine()
    m.dispatch({ type: 'paste-begin', text: `x${P}y`, selection: { start: 0, end: 0 } })
    expect(m.state.draft).toBe('xy')
    expect(m.state.occurrences).toEqual([])
  })

  it('sync hot-snapshot components mint inside the SAME transaction: one undo returns to pre-paste', () => {
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: 'hi ' })
    m.dispatch({
      type: 'paste-begin', text: '/alpha x', selection: { start: 3, end: 3 },
      components: [{ start: 0, end: 6, reference: refOf('alpha') }],
    })
    expect(m.state.draft).toBe(`hi ${P} x`)
    expect(m.state.occurrences).toEqual([expect.objectContaining({ ref: 'alpha', offset: 3 })])
    expect(m.state.paste?.insertedRange).toEqual({ start: 3, end: 6 })
    m.dispatch({ type: 'undo' })
    expect(m.state).toMatchObject({ draft: 'hi ', occurrences: [] })
  })

  it('async upgrade is an INDEPENDENT transaction: undo #1 → token text, undo #2 → pre-paste', () => {
    const m = new InputMachine()
    m.dispatch({ type: 'paste-begin', text: '/alpha rest', selection: { start: 0, end: 0 } })
    expect(m.state.paste?.attemptId).toBe(1)
    m.dispatch({ type: 'paste-upgrade', attemptId: 1, span: spanOf(m, 0, 6), reference: refOf('alpha') })
    expect(m.state.draft).toBe(`${P} rest`)
    expect(m.state.occurrences).toHaveLength(1)
    m.dispatch({ type: 'undo' })
    expect(m.state).toMatchObject({ draft: '/alpha rest', occurrences: [] })
    m.dispatch({ type: 'undo' })
    expect(m.state.draft).toBe('')
  })

  it('the attempt survives upgrades: successive tokens re-CAS against the advanced revision', () => {
    const m = new InputMachine()
    m.dispatch({ type: 'paste-begin', text: '/alpha /beta', selection: { start: 0, end: 0 } })
    m.dispatch({ type: 'paste-upgrade', attemptId: 1, span: spanOf(m, 0, 6), reference: refOf('alpha') })
    expect(m.state.paste?.insertedRange).toEqual({ start: 0, end: 7 })
    m.dispatch({ type: 'paste-upgrade', attemptId: 1, span: spanOf(m, 2, 7), reference: refOf('beta') })
    expect(m.state.draft).toBe(`${P} ${P} `)
    expect(m.state.occurrences.map(o => o.ref)).toEqual(['alpha', 'beta'])
    expect(m.state.paste?.insertedRange).toEqual({ start: 0, end: 4 })
  })

  it('a stale span CAS drops one upgrade without ending the attempt', () => {
    const m = new InputMachine()
    m.dispatch({ type: 'paste-begin', text: '/alpha /beta', selection: { start: 0, end: 0 } })
    const preSpan = spanOf(m, 7, 12)
    m.dispatch({ type: 'paste-upgrade', attemptId: 1, span: spanOf(m, 0, 6), reference: refOf('alpha') })
    expect(m.dispatch({ type: 'paste-upgrade', attemptId: 1, span: preSpan, reference: refOf('beta') })).toEqual([])
    expect(m.state.occurrences).toHaveLength(1)
    expect(m.state.paste).toBeDefined()
  })

  it('any new input transaction ends the attempt; late upgrades drop whole', () => {
    const m = new InputMachine()
    m.dispatch({ type: 'paste-begin', text: '/alpha', selection: { start: 0, end: 0 } })
    m.dispatch({ type: 'draft-changed', draft: '/alpha!', editRange: { start: 6, end: 6, insertedLength: 1 } })
    expect(m.state.paste).toBeUndefined()
    expect(m.dispatch({ type: 'paste-upgrade', attemptId: 1, span: spanOf(m, 0, 6), reference: refOf('alpha') })).toEqual([])
    expect(m.state.occurrences).toEqual([])
  })

  it('invalidate-paste (caret/selection/slash activity) and submit start end the attempt', () => {
    const a = new InputMachine()
    a.dispatch({ type: 'paste-begin', text: '/alpha', selection: { start: 0, end: 0 } })
    a.dispatch({ type: 'invalidate-paste' })
    expect(a.state.paste).toBeUndefined()

    const b = new InputMachine()
    b.dispatch({ type: 'paste-begin', text: 'plain text', selection: { start: 0, end: 0 } })
    b.dispatch({ type: 'enter', mode: 'queue' })
    expect(b.state.paste).toBeUndefined()
  })

  it('a mismatched attemptId is dropped (superseded paste)', () => {
    const m = new InputMachine()
    m.dispatch({ type: 'paste-begin', text: '/alpha', selection: { start: 0, end: 0 } })
    m.dispatch({ type: 'paste-begin', text: ' /beta', selection: { start: 6, end: 6 } })
    expect(m.state.paste?.attemptId).toBe(2)
    expect(m.dispatch({ type: 'paste-upgrade', attemptId: 1, span: spanOf(m, 0, 6), reference: refOf('alpha') })).toEqual([])
    expect(m.state.occurrences).toEqual([])
  })
})

describe('input-machine: set-invalid styling bits', () => {
  it('flags exactly the listed occurrences without a transaction', () => {
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: '/alp' })
    m.dispatch({ type: 'insert-ref', reference: refOf('alpha'), span: spanOf(m, 0, 4) })
    m.dispatch({ type: 'draft-changed', draft: `${P} /bet`, editRange: { start: 1, end: 1, insertedLength: 5 } })
    m.dispatch({ type: 'insert-ref', reference: refOf('beta'), span: spanOf(m, 2, 6) })
    const rev = m.state.draftRev
    m.dispatch({ type: 'set-invalid', invalidIds: [1] })
    expect(m.state.draftRev).toBe(rev)
    expect(m.state.occurrences.map(o => o.invalid === true)).toEqual([true, false])
    // Recovery: the same source/ref resolving again clears the bit.
    m.dispatch({ type: 'set-invalid', invalidIds: [] })
    expect(m.state.occurrences.every(o => o.invalid === undefined)).toBe(true)
  })

  it('a no-change call keeps the table reference (no spurious publish)', () => {
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: '/alp' })
    m.dispatch({ type: 'insert-ref', reference: refOf('alpha'), span: spanOf(m, 0, 4) })
    const table = m.state.occurrences
    expect(m.dispatch({ type: 'set-invalid', invalidIds: [] })).toEqual([])
    expect(m.state.occurrences).toBe(table)
  })
})

describe('input-machine: projectClipboard', () => {
  it('expands each placeholder to its occurrence clipboardText in draft order', () => {
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: 'use /alp' })
    m.dispatch({ type: 'insert-ref', reference: refOf('alpha'), span: spanOf(m, 4, 8) })
    m.dispatch({ type: 'draft-changed', draft: `use ${P} then /bet`, editRange: { start: 5, end: 5, insertedLength: 10 } })
    m.dispatch({ type: 'insert-ref', reference: refOf('beta'), span: spanOf(m, 11, 15) })
    expect(m.state.draft).toBe(`use ${P} then ${P} `)
    expect(projectClipboard(m.state)).toBe('use /alpha then /beta ')
  })

  it('is the identity on a chip-free draft', () => {
    expect(projectClipboard({ draft: 'plain text', occurrences: [] })).toBe('plain text')
  })
})

describe('decorations: scanTextRefs', () => {
  const LEX: ReadonlyMap<'/' | '@', readonly string[]> = new Map([
    ['/', ['commit-helper', 'fixture-demo']],
    ['@', ['worker-1']],
  ])

  it('matches lexicon tokens at line start and after whitespace, in draft order', () => {
    expect(scanTextRefs('/commit-helper then @worker-1 ok', LEX)).toEqual([
      { start: 0, end: 14, trigger: '/' },
      { start: 20, end: 29, trigger: '@' },
    ])
  })

  it('a cold (empty) lexicon scans nothing', () => {
    expect(scanTextRefs('/commit-helper', new Map())).toEqual([])
  })

  it('names off the lexicon do not match; triggers are routed per lexicon list', () => {
    expect(scanTextRefs('/unknown @commit-helper', LEX)).toEqual([])
  })

  it('word boundary: a trigger glued to text never matches', () => {
    expect(scanTextRefs('x/commit-helper', LEX)).toEqual([])
    expect(scanTextRefs('a@worker-1', LEX)).toEqual([])
  })

  it('tokens never cross a newline; a token straight after one matches', () => {
    expect(scanTextRefs('line\n/commit-helper', LEX)).toEqual([
      { start: 5, end: 19, trigger: '/' },
    ])
  })

  it('deriveDecorations threads the lexicon through as textRefs', () => {
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: 'use /commit-helper now' })
    expect(deriveDecorations(m.state, LEX).textRefs).toEqual([
      { start: 4, end: 18, trigger: '/' },
    ])
  })
})

describe('input-machine: decorations', () => {
  it('projects chips from the occurrence table with identity, offset, label, and invalid bit', () => {
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: '/alp' })
    m.dispatch({ type: 'insert-ref', reference: refOf('alpha'), span: spanOf(m, 0, 4) })
    m.dispatch({ type: 'set-invalid', invalidIds: [1] })
    expect(deriveDecorations(m.state)).toEqual({
      token: null,
      chips: [{ occurrenceId: 1, offset: 0, label: 'alpha', invalid: true }],
      textRefs: [],
      hint: null,
    })
  })

  it('claim token range and ghost hint show while claimed with blank args; args clear the hint', () => {
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: '/go' })
    m.dispatch({ type: 'begin-command', claim: claimOf('goal', 'objective'), span: spanOf(m, 0, 3) })
    expect(deriveDecorations(m.state)).toEqual({
      token: { start: 0, end: 6 },
      chips: [],
      textRefs: [],
      hint: 'objective',
    })
    m.dispatch({ type: 'draft-changed', draft: '/goal x' })
    expect(deriveDecorations(m.state)).toMatchObject({ token: { start: 0, end: 6 }, hint: null })
  })

  it('the token range persists through submitting; a hintless claim never ghosts', () => {
    const m = new InputMachine()
    enterSubmitting(m, 'goal', '')
    expect(deriveDecorations(m.state)).toEqual({ token: { start: 0, end: 6 }, chips: [], textRefs: [], hint: null })
  })
})

describe('input-machine: claimed lifecycle', () => {
  it('breaking startsWith(token) auto-releases back to plain', () => {
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: '/go' })
    m.dispatch({ type: 'begin-command', claim: claimOf('goal'), span: spanOf(m, 0, 3) })
    m.dispatch({ type: 'draft-changed', draft: '/goal make' })
    expect(m.state.phase).toBe('claimed')
    m.dispatch({ type: 'draft-changed', draft: '/goa make' })
    expect(m.state.phase).toBe('plain')
    expect(m.state.claim).toBeUndefined()
    expect(m.state.draft).toBe('/goa make')
  })

  it('explicit release returns to plain when nothing is in flight', () => {
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: '/go' })
    m.dispatch({ type: 'begin-command', claim: claimOf('goal'), span: spanOf(m, 0, 3) })
    expect(m.dispatch({ type: 'release' })).toEqual([])
    expect(m.state.phase).toBe('plain')
    expect(m.state.claim).toBeUndefined()
  })

  it('enter begins the submit transaction: args = draft minus token, multi-line legal', () => {
    const m = new InputMachine()
    const { attempt, claim } = enterSubmitting(m, 'goal', 'line1\nline2')
    expect(attempt.draftSnapshot).toBe('/goal line1\nline2')
    m.dispatch({ type: 'submit-settled', attempt, ok: true })
    expect(m.state.draft).toBe('')
    expect(claim.token).toBe('/goal ')
  })
})

describe('input-machine: submitting transaction', () => {
  it('enter and begin-command are locked; draft-changed is recorded without leaving submitting', () => {
    const m = new InputMachine()
    enterSubmitting(m, 'goal', 'x')
    expect(m.dispatch({ type: 'enter', mode: 'queue' })).toEqual([])
    expect(m.dispatch({ type: 'draft-changed', draft: '/goal y' })).toEqual([])
    expect(m.state).toMatchObject({ phase: 'submitting', draft: '/goal y' })
  })

  it('commit clears draft and occurrences, releases the claim, and relays the outcome text', () => {
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: '@wor' })
    m.dispatch({ type: 'insert-ref', reference: refOf('worker-1', 'subagent'), span: spanOf(m, 0, 4) })
    m.dispatch({ type: 'draft-changed', draft: `${P}/go`, editRange: { start: 1, end: 1, insertedLength: 3 } })
    m.dispatch({ type: 'draft-changed', draft: '/go', editRange: { start: 0, end: 1, insertedLength: 0 } })
    m.dispatch({ type: 'begin-command', claim: claimOf('goal'), span: spanOf(m, 0, 3) })
    m.dispatch({ type: 'draft-changed', draft: '/goal go' })
    const attempt = effectAt(m.dispatch({ type: 'enter', mode: 'queue' }), 0, 'begin-submit').attempt
    const fx = m.dispatch({ type: 'submit-settled', attempt, ok: true, outcome: { kind: 'success', text: 'goal set' } })
    expect(fx).toEqual([{ type: 'notice', level: 'info', text: 'goal set' }])
    expect(m.state).toMatchObject({ phase: 'plain', draft: '', occurrences: [] })
    expect(m.state.claim).toBeUndefined()
  })

  it('rollback with an undeviated draft keeps the snapshot and re-enters claimed (same claim)', () => {
    const m = new InputMachine()
    const { attempt } = enterSubmitting(m, 'goal', 'x')
    const fx = m.dispatch({ type: 'submit-settled', attempt, ok: false, message: 'boom' })
    expect(fx).toEqual([{ type: 'notice', level: 'error', text: 'boom' }])
    expect(m.state).toMatchObject({ phase: 'claimed', draft: '/goal x' })
    expect(m.state.claim?.token).toBe('/goal ')
  })

  it('rollback with a deviated draft only notices — the newer input wins', () => {
    const m = new InputMachine()
    const { attempt } = enterSubmitting(m, 'goal', 'x')
    m.dispatch({ type: 'draft-changed', draft: 'fresh typing' })
    const fx = m.dispatch({ type: 'submit-settled', attempt, ok: false, message: 'boom' })
    expect(fx).toEqual([{ type: 'notice', level: 'error', text: 'boom' }])
    expect(m.state).toMatchObject({ phase: 'plain', draft: 'fresh typing' })
    expect(m.state.claim).toBeUndefined()
  })

  it('enter-path rollback cannot re-enter claimed when the snapshot never carried the bare token prefix', () => {
    // '\n\n/goal x' round-trips through adjudication; the whitespace prefix
    // would instantly break the claimed watch, so rollback lands plain.
    const m = new InputMachine()
    const attempt = enterAdjudicating(m, '\n\n/goal x')
    m.dispatch({ type: 'adjudicated', attempt, outcome: { claim: claimOf('goal') } })
    const fx = m.dispatch({ type: 'submit-settled', attempt, ok: false, message: 'boom' })
    expect(fx).toEqual([{ type: 'notice', level: 'error', text: 'boom' }])
    expect(m.state).toMatchObject({ phase: 'plain', draft: '\n\n/goal x' })
  })

  it('a stale settle after rollback + resubmit is dropped (anti-backwash)', () => {
    const m = new InputMachine()
    const { attempt: first } = enterSubmitting(m, 'goal', 'x')
    m.dispatch({ type: 'submit-settled', attempt: first, ok: false, message: 'retry' })
    const second = effectAt(m.dispatch({ type: 'enter', mode: 'queue' }), 0, 'begin-submit').attempt
    expect(second.seq).not.toBe(first.seq)
    expect(m.dispatch({ type: 'submit-settled', attempt: first, ok: true })).toEqual([])
    expect(m.state.phase).toBe('submitting')
    m.dispatch({ type: 'submit-settled', attempt: second, ok: true })
    expect(m.state.draft).toBe('')
  })

  it('release mid-flight aborts the attempt and later settles are dropped', () => {
    const m = new InputMachine()
    const { attempt } = enterSubmitting(m, 'goal', 'x')
    expect(m.dispatch({ type: 'release' })).toEqual([])
    expect(attempt.signal.aborted).toBe(true)
    expect(m.state.phase).toBe('plain')
    expect(m.dispatch({ type: 'submit-settled', attempt, ok: true })).toEqual([])
    expect(m.state.draft).toBe('/goal x')
  })
})

describe('input-machine: per-session isolation', () => {
  it('one instance per session: A submitting never locks B; settles land on their own instance', () => {
    const a = new InputMachine()
    const b = new InputMachine()
    const { attempt } = enterSubmitting(a, 'goal', 'from A')
    // B stays fully live while A holds its lock.
    b.dispatch({ type: 'draft-changed', draft: '/mo' })
    b.dispatch({ type: 'begin-command', claim: claimOf('model'), span: spanOf(b, 0, 3) })
    expect(b.state.phase).toBe('claimed')
    expect(a.state.phase).toBe('submitting')
    // A's commit falls back to A alone.
    a.dispatch({ type: 'submit-settled', attempt, ok: true })
    expect(a.state).toMatchObject({ phase: 'plain', draft: '' })
    expect(b.state).toMatchObject({ phase: 'claimed', draft: '/model ' })
  })
})
