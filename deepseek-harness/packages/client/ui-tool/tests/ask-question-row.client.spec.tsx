// @vitest-environment jsdom
/**
 * ask_user_question toolview acceptance: `waiting` summary while running,
 * answered-count from the result JSON once settled (skipped answers
 * excluded), the cancelled/interrupted verdicts off ASK_CANCELLED and
 * ASK_ABORTED, shared ToolRow state
 * semantics for interrupted/failed calls, and generic fallbacks on
 * malformed results.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
// Export discipline: packages/client/AGENTS.md.
import { AskQuestionRow, askQuestionToolview } from '../src/client/tool/toolviews/ask-question-row.tsx'
import { zh } from '@deepseek-ai/dsh-client-ui-conversation/src/client/locales.ts'

afterEach(cleanup)

const ARGS = JSON.stringify({ questions: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] })

const resultNode = (argsRaw: string, resultText: string | null, over?: Partial<ToolResultNode>): ToolResultNode => ({
  kind: 'tool-result', seq: 10, time: 2_000, callTime: 1_000, callId: 'c1',
  call: { name: 'ask_user_question', argsRaw },
  content: resultText === null ? [] : [{ type: 'text', text: resultText }],
  isError: false, callView: null, resultView: null, subCalls: [], ...over,
})

const runningCall = (argsRaw: string) =>
  ({ callId: 'c1', name: 'ask_user_question', argsRaw, turn: 1, step: 1, time: 1_000, callView: null, subCalls: [] })

// Standard locale seat stub mirroring the real ns → common → key chain.
const t = makeTranslate(zh, commonZh)

function rowProps(block: unknown): Parameters<typeof AskQuestionRow>[0] {
  return {
    callId: 'c1', toolName: 'ask_user_question', block, t,
    openFile: vi.fn(),
    sessionId: 's1',
    useSessions: () => undefined,
  } as unknown as Parameters<typeof AskQuestionRow>[0]
}

const answers = (entries: unknown[]): string => JSON.stringify({ answers: entries })

describe('AskQuestionRow', () => {
  it('running call reads waiting (args-independent: the composer takeover shows the questions)', () => {
    const view = render(<AskQuestionRow {...rowProps(runningCall(ARGS))} />)
    expect(screen.getByText('提问')).toBeTruthy()
    expect(screen.getByText('等待回答')).toBeTruthy()
    expect(view.container.querySelector('[data-state="running"]')).not.toBeNull()
  })

  it('settled result counts answered entries (selected choices or custom text)', () => {
    render(<AskQuestionRow {...rowProps(resultNode(ARGS, answers([
      { id: 'a', selected: ['x'] },
      { id: 'b', selected: [], custom: 'freeform' },
      { id: 'c', selected: ['y', 'z'], custom: '' },
    ])))} />)
    expect(screen.getByText('3/3 已回答')).toBeTruthy()
  })

  it('skipped questions (no selection, no custom) stay out of the answered count', () => {
    const view = render(<AskQuestionRow {...rowProps(resultNode(ARGS, answers([
      { id: 'a', selected: ['x'] },
      { id: 'b', selected: [], custom: '' },
      { id: 'c' },
    ])))} />)
    expect(screen.getByText('1/3 已回答')).toBeTruthy()
    expect(view.container.querySelector('[data-state="ok"]')).not.toBeNull()
  })

  it.each([
    { label: 'non-JSON result text', text: 'oops' },
    { label: 'non-object result root', text: '"str"' },
    { label: 'null result root', text: 'null' },
    { label: 'missing answers array', text: '{"other":1}' },
    { label: 'null answer entries', text: '{"answers":[null]}' },
    { label: 'empty result content', text: null },
  ])('settled result falls back to the generic summary on $label', ({ text }) => {
    render(<AskQuestionRow {...rowProps(resultNode(ARGS, text))} />)
    expect(screen.getByText(`ask_user_question · ${ARGS}`)).toBeTruthy()
  })

  it('user cancellation names the verdict instead of the generic failed shape', () => {
    // ASK_CANCELLED: the apiproxy ask_user_question handler's cancel error.
    const view = render(<AskQuestionRow {...rowProps(resultNode(ARGS, null,
      { isError: true, error: { name: 'UserQuestionError', code: 'ASK_CANCELLED' } }))} />)
    expect(screen.getByText('已取消')).toBeTruthy()
    expect(view.container.querySelector('[data-state="error"]')).not.toBeNull()
  })

  it('a turn abort while pending reads interrupted with stopped semantics', () => {
    // ASK_ABORTED: the apiproxy ask handler's turn-abort settlement.
    const view = render(<AskQuestionRow {...rowProps(resultNode(ARGS, null,
      { isError: true, error: { name: 'UserQuestionError', code: 'ASK_ABORTED' } }))} />)
    expect(screen.getByText('已中断')).toBeTruthy()
    expect(view.container.querySelector('[data-state="stopped"]')).not.toBeNull()
  })

  it('an interrupted turn reads as stopped, not cancelled', () => {
    const view = render(<AskQuestionRow {...rowProps(resultNode(ARGS, null,
      { isError: true, error: { name: 'Interrupted', code: 'interrupted' } }))} />)
    expect(view.container.querySelector('[data-state="stopped"]')).not.toBeNull()
    expect(screen.queryByText('已取消')).toBeNull()
    expect(screen.getByText(`ask_user_question · ${ARGS}`)).toBeTruthy()
  })

  it('other tool errors keep the generic summary with the error state', () => {
    const view = render(<AskQuestionRow {...rowProps(resultNode(ARGS, null, { isError: true }))} />)
    expect(view.container.querySelector('[data-state="error"]')).not.toBeNull()
    expect(screen.getByText(`ask_user_question · ${ARGS}`)).toBeTruthy()
  })

  it('window-truncated result (call head lost) falls back to the callId summary', () => {
    render(<AskQuestionRow {...rowProps(resultNode('', null, { call: null }))} />)
    expect(screen.getByText('ask_user_question · c1')).toBeTruthy()
  })

  it('leading toggle expands the raw args body', () => {
    render(<AskQuestionRow {...rowProps(resultNode(ARGS, answers([])))} />)
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByRole('button', { expanded: true })).toBeTruthy()
  })

  it('askQuestionToolview injects the toolview declaration directly', () => {
    expect(askQuestionToolview.name).toBe('ask-question-toolview')
    expect(askQuestionToolview.inject).toEqual(['slots'])
    const register = vi.fn(() => () => undefined)
    const inject = vi.fn((_name: string, callback: () => () => void) => callback())
    askQuestionToolview.apply({ slots: { inject, register } } as never)
    expect(inject).toHaveBeenCalledWith('tool.call.toolview', expect.any(Function))
    expect(register).toHaveBeenCalledWith(
      { name: 'tool.call.toolview', key: 'ask_user_question', locale: 'conversation' },
      AskQuestionRow,
    )
  })
})
