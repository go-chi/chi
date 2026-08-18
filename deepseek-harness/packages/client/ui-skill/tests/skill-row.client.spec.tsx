// @vitest-environment jsdom
// Dedicated skill tool row: replay-stable naming, lifecycle states, disclosure,
// keyboard operation, exact output, and the trajectory Inspect handoff.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RunningToolCall, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { SkillRow } from '../src/client/SkillRow.tsx'
import { zh } from '../src/client/locales.ts'

type SkillRowProps = Parameters<typeof SkillRow>[0]

const t: SkillRowProps['t'] = makeTranslate(zh, commonZh)

afterEach(cleanup)

function settled(over: Partial<ToolResultNode> = {}): ToolResultNode {
  return {
    kind: 'tool-result',
    seq: 3,
    time: 3_000,
    callId: 'call-skill',
    call: { name: 'skill', argsRaw: '{"name":"dsh-manage-issues"}' },
    callTime: 2_000,
    content: [{ type: 'text', text: 'Follow the issue workflow.\nKeep project fields in sync.' }],
    isError: false,
    callView: null,
    resultView: null,
    subCalls: [],
    ...over,
  }
}

function running(argsRaw = '{"name":"dsh-manage-issues"}'): RunningToolCall {
  return {
    callId: 'call-skill', name: 'skill', argsRaw, turn: 1, step: 1, time: 2_000, callView: null, subCalls: [],
  }
}

function props(block: SkillRowProps['block'], inspect?: () => void): SkillRowProps {
  return {
    callId: block.callId,
    toolName: 'skill',
    block,
    openFile: vi.fn(),
    inspect,
    t,
  } as unknown as SkillRowProps
}

describe('SkillRow', () => {
  it('renders a compact Bash-shaped summary and discloses the exact instructions', () => {
    const inspect = vi.fn()
    const view = render(<SkillRow {...props(settled(), inspect)} />)
    const row = screen.getByRole('button', { name: 'Skilldsh-manage-issues' })
    expect(row.getAttribute('aria-expanded')).toBe('false')
    expect(view.container.querySelector('[data-tool="skill"]')?.getAttribute('data-state')).toBe('ok')
    expect(view.container.querySelector('[data-tool="skill"] svg')?.getAttribute('width')).toBe('14')
    expect(screen.queryByLabelText('说明')).toBeNull()

    fireEvent.click(row)
    expect(row.getAttribute('aria-expanded')).toBe('true')
    const card = screen.getByLabelText('说明')
    expect(card.textContent).toBe('说明Follow the issue workflow.\nKeep project fields in sync.')
    expect(view.container.textContent).not.toContain('{"name":"dsh-manage-issues"}')
    fireEvent.click(screen.getByRole('button', { name: 'Inspect' }))
    expect(inspect).toHaveBeenCalledTimes(1)

    fireEvent.click(row)
    expect(row.getAttribute('aria-expanded')).toBe('false')
  })

  it('supports Enter and Space while ignoring unrelated keys', () => {
    render(<SkillRow {...props(settled())} />)
    const row = screen.getByRole('button')
    fireEvent.keyDown(row, { key: 'Escape' })
    expect(row.getAttribute('aria-expanded')).toBe('false')
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(row.getAttribute('aria-expanded')).toBe('true')
    fireEvent.keyDown(row, { key: ' ' })
    expect(row.getAttribute('aria-expanded')).toBe('false')
  })

  it('keeps a running call compact and announces its state', () => {
    const view = render(<SkillRow {...props(running())} />)
    const row = view.container.querySelector('[data-tool="skill"] > div')!
    expect(row.getAttribute('role')).toBeNull()
    expect(view.container.textContent).toContain('正在加载 skill')
    expect(view.container.textContent).toContain('dsh-manage-issues')
    expect(view.container.querySelector('svg [fill="currentColor"]')).not.toBeNull()
  })

  it('uses the first failure line in the summary and exposes the full error', () => {
    const view = render(<SkillRow {...props(settled({
      content: [{ type: 'text', text: 'SkillError: missing resource\nCheck SKILL.md.' }],
      isError: true,
      error: { name: 'SkillError', code: 'missing' },
    }))} />)
    const row = screen.getByRole('button', { name: 'skill 加载失败SkillSkillError: missing resource' })
    expect(view.container.querySelector('[data-tool="skill"]')?.getAttribute('data-state')).toBe('error')
    expect(row.textContent).not.toContain('Check SKILL.md.')
    fireEvent.click(row)
    const output = view.container.querySelector('pre')!
    expect(output.textContent).toBe('SkillError: missing resource\nCheck SKILL.md.')
    expect(output.getAttribute('data-error')).toBe('true')
  })

  it('renders stopped, structured, and structured-error durable outcomes', () => {
    const stoppedView = render(<SkillRow {...props(settled({
      error: { name: 'InterruptedError', code: 'interrupted' },
    }))} />)
    expect(stoppedView.container.textContent).toContain('skill 加载已中止')
    expect(stoppedView.container.querySelector('[data-state="warning"]')).not.toBeNull()
    cleanup()

    const structuredView = render(<SkillRow {...props(settled({
      content: [{ type: 'reasoning', text: 'structured instruction note' }],
    }))} />)
    fireEvent.click(screen.getByRole('button'))
    expect(structuredView.container.textContent).toContain('"type": "reasoning"')
    cleanup()

    render(<SkillRow {...props(settled({
      content: [],
      isError: true,
      error: { name: 'SkillError', code: 'missing' },
    }))} />)
    const errorRow = screen.getByRole('button', { name: 'skill 加载失败SkillSkillError: missing' })
    fireEvent.click(errorRow)
    expect(screen.getAllByText('SkillError: missing')).toHaveLength(2)
  })

  it('falls back to durable args or call id when the skill name is unavailable', () => {
    const invalid = render(<SkillRow {...props(running('{"name":\n'))} />)
    expect(invalid.container.textContent).toContain('{"name":')
    cleanup()

    const scalar = render(<SkillRow {...props(running('"raw-name"'))} />)
    expect(scalar.container.textContent).toContain('"raw-name"')
    cleanup()

    const emptyName = render(<SkillRow {...props(running('{"name":""}'))} />)
    expect(emptyName.container.textContent).toContain('{"name":""}')
    cleanup()

    const blank = render(<SkillRow {...props(settled({ call: null, content: [] }))} />)
    expect(blank.container.textContent).toContain('call-skill')
    expect(blank.container.querySelector('[role="button"]')).toBeNull()
    expect(blank.container.textContent).not.toContain('正在加载 skill')
  })
})
