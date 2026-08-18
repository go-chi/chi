// @vitest-environment jsdom
// The plan-review takeover, driven through the composer entry that routes to
// it: a request carrying the intent must reach the decision card and answer
// with the asker's own option labels, and a request that does not (or cannot)
// must keep the generic question flow.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type {
  ConversationSnapshot, SessionId, SessionListState, WorkspaceListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import { PendingWait } from '@deepseek-ai/dsh-client-runtime/client'
import type { RpcReceipt } from '@deepseek-ai/dsh-api-remotes/client'
import { RpcId } from '@deepseek-ai/dsh-client-connection/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import { planReviewOf, type QuestionComposerProps, type QuestionWait } from '../src/client/contract/slots.ts'
import { QuestionComposer } from '../src/client/QuestionComposer.tsx'
import { en, zh } from '../src/client/locales.ts'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'

afterEach(cleanup)

const SID = 's1' as SessionId

/** Seat stub over a dictionary pair mirroring the real lookup chain: package dictionary, then common vocabulary, then the key. */
const seatOver = (dict: Record<string, string>, common: Record<string, string>): QuestionComposerProps['t'] =>
  (key => dict[key] ?? common[key] ?? key)

/** Framework standard-kit stubs: the panel consumes only the locale seat. */
const kit = {
  sessionId: SID,
  session: undefined,
  useSession: (() => { throw new Error('unused') }) as unknown as SnapshotSelectorHook<ConversationSnapshot>,
  useSessions: (() => { throw new Error('unused') }) as unknown as SnapshotSelectorHook<SessionListState>,
  useWorkspaces: (() => { throw new Error('unused') }) as unknown as SnapshotSelectorHook<WorkspaceListState>,
  useProjection: (() => undefined) as never,
  useInput: (() => { throw new Error('unused') }) as never,
  inputActions: { setDraft: () => { throw new Error('unused') }, submit: () => { throw new Error('unused') } } as never,
  t: seatOver(zh, commonZh),
}

const PLAN = '# Ship the picker\n\n- read the store\n- render the rows\n'

/** The plan-mode request shape: one question, the plan as detail, approve named. */
const questions = (): QuestionWait['payload']['questions'] => [{
  id: 'plan-review',
  header: 'Plan review',
  question: 'Approve this plan and leave plan mode?',
  detail: PLAN,
  options: [
    { label: 'Approve', description: 'Leave plan mode; the plan is carried out from the next step.' },
    { label: 'Keep planning', description: 'Stay in plan mode; feedback goes back to the model.' },
  ],
  intent: { kind: 'plan-review', approve: 'Approve' },
}]

/** Carrier fixture over a scripted respond carrier. */
function wait(
  payload: QuestionWait['payload'] = { questions: questions() },
  respond = vi.fn(() => Promise.resolve<RpcReceipt>({ accepted: true })),
) {
  return { carrier: new PendingWait('question', RpcId('q-1'), SID, payload, respond), respond }
}

/** The client-response envelope respond must have received for a decision. */
function decidedEnvelope(label: string) {
  return {
    type: 'client-response', rpcId: RpcId('q-1'),
    result: { ok: true, value: { sessionId: SID, answer: { answers: [{ id: 'plan-review', selected: [label] }] } } },
  }
}

describe('planReviewOf', () => {
  it('narrows a plan-review request to its decision, options included', () => {
    expect(planReviewOf(questions())).toEqual({
      id: 'plan-review',
      question: 'Approve this plan and leave plan mode?',
      plan: PLAN,
      approve: { label: 'Approve', description: 'Leave plan mode; the plan is carried out from the next step.' },
      decline: { label: 'Keep planning', description: 'Stay in plan mode; feedback goes back to the model.' },
    })
  })

  it('leaves the decline absent when the asker offered approve alone', () => {
    const [question] = questions()
    const review = planReviewOf([{ ...question as object, options: [{ label: 'Approve' }] } as never])
    expect(review?.approve).toEqual({ label: 'Approve' })
    expect(review === undefined ? true : 'decline' in review).toBe(false)
  })

  it.each([
    ['a batch of more than one question', () => [...questions(), ...questions()]],
    ['no intent at all', () => [{ ...questions()[0] as object, intent: undefined }]],
    ['an intent without the plan as detail', () => [{ ...questions()[0] as object, detail: undefined }]],
    ['an intent whose approve names no option', () => [{
      ...questions()[0] as object, intent: { kind: 'plan-review', approve: 'Ship it' },
    }]],
    ['an intent with no options at all', () => [{ ...questions()[0] as object, options: undefined }]],
    // Two buttons cannot send a third label or a combination, and the generic
    // flow can: an intent never costs the user a reachable answer.
    ['a third option the card could not offer', () => [{
      ...questions()[0] as object,
      options: [{ label: 'Approve' }, { label: 'Keep planning' }, { label: 'Start over' }],
    }]],
    ['a multi-select decision', () => [{ ...questions()[0] as object, multiSelect: true }]],
  ])('declines %s, leaving the request to the generic flow', (_case, build) => {
    expect(planReviewOf(build() as never)).toBeUndefined()
  })

  it('declines an empty batch, which the generic flow reports as such', () => {
    expect(planReviewOf([])).toBeUndefined()
  })
})

describe('PlanReviewPanel', () => {
  it('renders the plan under a review strip, with none of the quiz affordances', () => {
    const { carrier } = wait()
    render(<QuestionComposer matched={carrier} interactions={[carrier]} {...kit} />)

    expect(document.querySelector('[data-plan-review-key="q:q-1"]')).toBeTruthy()
    expect(screen.getByText(zh['plan.header'])).toBeTruthy()
    // The plan renders as markdown, so its heading is a heading.
    expect(screen.getByRole('heading', { name: 'Ship the picker' })).toBeTruthy()
    expect(screen.getByText('render the rows')).toBeTruthy()
    // The question text stays as the card's accessible name rather than a title
    // that reads like a test item.
    expect(screen.getByLabelText('Approve this plan and leave plan mode?')).toBeTruthy()
    // No pager, no numbered options, no skip, no custom answer.
    expect(screen.queryByText('1 / 1')).toBeNull()
    expect(screen.queryByRole('radio')).toBeNull()
    expect(screen.queryByText(zh['action.skip'])).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('answers with the asker\'s approve label and keeps its description as the tooltip', () => {
    const { carrier, respond } = wait()
    render(<QuestionComposer matched={carrier} interactions={[carrier]} {...kit} />)

    const approve = screen.getByRole('button', { name: zh['plan.approve'] })
    expect(approve.getAttribute('title')).toBe('Leave plan mode; the plan is carried out from the next step.')
    fireEvent.click(approve)
    expect(respond).toHaveBeenCalledWith(decidedEnvelope('Approve'))
    // One-shot: every action locks until the host's resolved frame lands.
    expect(approve.hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: zh['plan.decline'] }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(approve)
    expect(respond).toHaveBeenCalledTimes(1)
  })

  it('answers with the asker\'s decline label', () => {
    const { carrier, respond } = wait()
    render(<QuestionComposer matched={carrier} interactions={[carrier]} {...kit} />)

    fireEvent.click(screen.getByRole('button', { name: zh['plan.decline'] }))
    expect(respond).toHaveBeenCalledWith(decidedEnvelope('Keep planning'))
  })

  it('dismisses the request so the composer returns for a plain message', () => {
    const { carrier, respond } = wait()
    render(<QuestionComposer matched={carrier} interactions={[carrier]} {...kit} />)

    fireEvent.click(screen.getByRole('button', { name: zh['plan.discuss'] }))
    expect(respond).toHaveBeenCalledWith({
      type: 'client-response', rpcId: RpcId('q-1'),
      result: {
        ok: false,
        error: { code: 'cancelled', message: 'the user closed this question request', details: {} },
      },
    })
  })

  it('omits the tooltip for an option carrying no description', () => {
    const { carrier } = wait({ questions: [{
      ...questions()[0] as object,
      options: [{ label: 'Approve' }, { label: 'Keep planning' }],
    }] as never })
    render(<QuestionComposer matched={carrier} interactions={[carrier]} {...kit} />)

    expect(screen.getByRole('button', { name: zh['plan.approve'] }).hasAttribute('title')).toBe(false)
    expect(screen.getByRole('button', { name: zh['plan.decline'] }).hasAttribute('title')).toBe(false)
  })

  it('hides the decline action when the asker offered approve alone', () => {
    const { carrier } = wait({ questions: [{
      ...questions()[0] as object, options: [{ label: 'Approve' }],
    }] as never })
    render(<QuestionComposer matched={carrier} interactions={[carrier]} {...kit} />)

    expect(screen.queryByRole('button', { name: zh['plan.decline'] })).toBeNull()
    expect(screen.getByRole('button', { name: zh['plan.approve'] })).toBeTruthy()
  })

  it('re-arms the actions and says why when the decision does not land', async () => {
    const { carrier, respond } = wait(
      { questions: questions() },
      vi.fn(() => Promise.resolve<RpcReceipt>({ accepted: false, reason: 'not-pending' })),
    )
    render(<QuestionComposer matched={carrier} interactions={[carrier]} {...kit} />)

    fireEvent.click(screen.getByRole('button', { name: zh['plan.approve'] }))
    const failure = await screen.findByText('question response rejected: not-pending')
    expect(failure.getAttribute('role')).toBe('status')
    // Re-armed for the retry: a lost click must not leave a dead card.
    expect(screen.getByRole('button', { name: zh['plan.approve'] }).hasAttribute('disabled')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: zh['plan.approve'] }))
    expect(respond).toHaveBeenCalledTimes(2)
  })

  it('reports a non-Error transport failure as its stringified value', async () => {
    // A non-Error rejection is the case under test: a carrier can reject with
    // anything, and the panel must still show the user something.
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors
    const { carrier } = wait({ questions: questions() }, vi.fn(() => Promise.reject('socket gone')))
    render(<QuestionComposer matched={carrier} interactions={[carrier]} {...kit} />)

    fireEvent.click(screen.getByRole('button', { name: zh['plan.discuss'] }))
    expect(await screen.findByText('socket gone')).toBeTruthy()
  })

  it('carries the same decision surface in English', () => {
    const { carrier } = wait()
    render(<QuestionComposer matched={carrier} interactions={[carrier]} {...kit} t={seatOver(en, commonEn)} />)

    expect(screen.getByText('Plan review')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Refuse' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Chat about it' })).toBeTruthy()
  })
})
