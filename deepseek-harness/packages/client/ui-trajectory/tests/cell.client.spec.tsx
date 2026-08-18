// @vitest-environment jsdom
/**
 * TrajectoryCell presentation: kind tags, ellipsis-hosting text, Message
 * metric columns, own-duration formatting, and selected ring.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import {
  formatElapsedSeconds,
  TrajectoryCell,
  type TrajectoryCellKind,
} from '../src/client/TrajectoryCell.tsx'
import { formatDurationMillis } from '../src/client/trajectory-record.ts'

afterEach(cleanup)

describe('formatDurationMillis', () => {
  it('formats exact millisecond labels with thousands separators', () => {
    expect(formatDurationMillis(0)).toBe('0 ms')
    expect(formatDurationMillis(29)).toBe('29 ms')
    expect(formatDurationMillis(500)).toBe('500 ms')
    expect(formatDurationMillis(1_500)).toBe('1,500 ms')
    expect(formatDurationMillis(235_200)).toBe('235,200 ms')
    expect(formatDurationMillis(null)).toBe('—')
    expect(formatDurationMillis(Number.NaN)).toBe('—')
  })
})

describe('formatElapsedSeconds', () => {
  it('formats known durations and uses an em dash when absent', () => {
    expect(formatElapsedSeconds(null)).toBe('—')
    expect(formatElapsedSeconds(235)).toBe('235,000 ms')
    expect(formatElapsedSeconds(235.0)).toBe('235,000 ms')
    expect(formatElapsedSeconds(235.2)).toBe('235,200 ms')
    expect(formatElapsedSeconds(235.25)).toBe('235,250 ms')
    expect(formatElapsedSeconds(0)).toBe('0 ms')
    expect(formatElapsedSeconds(0.029)).toBe('29 ms')
    expect(formatElapsedSeconds(0.5)).toBe('500 ms')
    expect(formatElapsedSeconds(1.5)).toBe('1,500 ms')
    expect(formatElapsedSeconds(Number.NaN)).toBe('—')
  })
})

describe('TrajectoryCell', () => {
  it('renders index, kind tag, text, and time for a Tool row', () => {
    render(
      <TrajectoryCell
        index={6}
        kind="tool"
        text="bash · Read src/index.ts"
        timeSeconds={5}
      />,
    )
    expect(screen.getByText('#6')).toBeTruthy()
    expect(screen.getByText('Tool')).toBeTruthy()
    expect(screen.getByText('bash · Read src/index.ts')).toBeTruthy()
    expect(screen.getByText('5,000 ms')).toBeTruthy()
  })

  it('Message rows expose Input / Output / Think metric columns before time', () => {
    const { container } = render(
      <TrajectoryCell
        index={3}
        kind="message"
        text="Let me now read the actual source files to understa..."
        timeSeconds={235.2}
        input={136}
        output={381}
        think={155}
      />,
    )
    expect(screen.getByText('Message')).toBeTruthy()
    expect(screen.getByText('136')).toBeTruthy()
    expect(screen.getByText('381')).toBeTruthy()
    expect(screen.getByText('155')).toBeTruthy()
    expect(screen.getByText('235,200 ms')).toBeTruthy()
    const texts = [...container.querySelectorAll('span')].map(el => el.textContent)
    expect(texts.indexOf('136')).toBeLessThan(texts.indexOf('381'))
    expect(texts.indexOf('381')).toBeLessThan(texts.indexOf('155'))
    expect(texts.indexOf('155')).toBeLessThan(texts.indexOf('235,200 ms'))
  })

  it('selected marks the row for the brand-primary inset ring', () => {
    const { container } = render(
      <TrajectoryCell index={15} kind="message" text="pictur..." timeSeconds={123.6} selected />,
    )
    expect(container.firstElementChild?.getAttribute('data-selected')).toBe('true')
  })

  it.each([
    ['user', 'User'],
    ['tool', 'Tool'],
  ] as const)('kind %s shows the %s tag and no metric columns', (kind: TrajectoryCellKind, label: string) => {
    const { container } = render(
      <TrajectoryCell index={1} kind={kind} text="summary" timeSeconds={kind === 'user' ? 0 : null} input={1} output={2} think={3} />,
    )
    expect(screen.getByText(label)).toBeTruthy()
    expect(container.querySelector('[data-kind]')?.getAttribute('data-kind')).toBe(kind)
    expect(screen.queryByText('1')).toBeNull()
    expect(screen.queryByText('2')).toBeNull()
    expect(screen.queryByText('3')).toBeNull()
  })
})
