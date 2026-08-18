// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { isSafariBrowser, repairSafariTextareaLayout } from '../src/client/skeleton/safari.ts'

describe('Safari browser detection', () => {
  it.each([
    {
      name: 'desktop Safari',
      vendor: 'Apple Computer, Inc.',
      userAgent: 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Safari/605.1.15',
      expected: true,
    },
    {
      name: 'mobile Safari',
      vendor: 'Apple Computer, Inc.',
      userAgent: 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
      expected: true,
    },
    {
      name: 'desktop Chromium',
      vendor: 'Google Inc.',
      userAgent: 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      expected: false,
    },
    {
      name: 'Chrome on iOS',
      vendor: 'Apple Computer, Inc.',
      userAgent: 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1',
      expected: false,
    },
    {
      name: 'Edge on iOS with Safari tokens',
      vendor: 'Apple Computer, Inc.',
      userAgent: 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 EdgiOS/140.0 Mobile/15E148 Safari/604.1',
      expected: false,
    },
    {
      name: 'Opera on iOS with Safari tokens',
      vendor: 'Apple Computer, Inc.',
      userAgent: 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 OPiOS/6.0 Mobile/15E148 Safari/604.1',
      expected: false,
    },
    {
      name: 'Apple web view',
      vendor: 'Apple Computer, Inc.',
      userAgent: 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
      expected: false,
    },
  ])('identifies $name', ({ vendor, userAgent, expected }) => {
    expect(isSafariBrowser({ vendor, userAgent })).toBe(expected)
  })
})

describe('Safari textarea layout recovery', () => {
  it('does nothing while the textarea owns no scrollable overflow', () => {
    const input = document.createElement('textarea')
    Object.defineProperty(input, 'clientHeight', { value: 28 })
    Object.defineProperty(input, 'scrollHeight', { value: 28 })

    repairSafariTextareaLayout(input)

    expect(input.style.height).toBe('')
  })

  it('invalidates a stale native layout and restores the owned height', () => {
    const input = document.createElement('textarea')
    const scrollport = document.createElement('div')
    scrollport.setAttribute('data-input-scroll', '')
    scrollport.appendChild(input)
    input.value = 'abcdef'
    input.setSelectionRange(3, 3)
    input.style.height = '100%'
    scrollport.style.height = '100%'
    let inputRepaired = false
    let scrollportRepaired = false
    const inputLayouts: string[] = []
    const scrollportLayouts: string[] = []
    Object.defineProperty(input, 'clientHeight', {
      get: () => input.style.height === '29px' ? 29 : 28,
    })
    Object.defineProperty(input, 'scrollHeight', {
      get: () => inputRepaired ? 28 : 52,
    })
    Object.defineProperty(input, 'offsetHeight', {
      get: () => {
        inputLayouts.push(input.style.height)
        if (input.style.height === '100%') inputRepaired = true
        return input.clientHeight
      },
    })
    Object.defineProperty(scrollport, 'clientHeight', {
      get: () => {
        if (scrollport.style.height === '53px') return 53
        if (inputRepaired && !scrollportRepaired) return 52
        return 28
      },
    })
    Object.defineProperty(scrollport, 'offsetHeight', {
      get: () => {
        scrollportLayouts.push(scrollport.style.height)
        if (scrollport.style.height === '100%') scrollportRepaired = true
        return scrollport.clientHeight
      },
    })

    repairSafariTextareaLayout(input)

    expect(inputLayouts).toEqual(['29px', '100%'])
    expect(scrollportLayouts).toEqual(['53px', '100%'])
    expect(input.style.height).toBe('100%')
    expect(scrollport.style.height).toBe('100%')
    expect(input.scrollHeight).toBe(input.clientHeight)
    expect(scrollport.clientHeight).toBe(28)
    expect([input.selectionStart, input.selectionEnd]).toEqual([3, 3])
  })

  it('does nothing outside the composer scrollport', () => {
    const input = document.createElement('textarea')
    Object.defineProperty(input, 'clientHeight', { value: 28 })
    Object.defineProperty(input, 'scrollHeight', { value: 52 })

    repairSafariTextareaLayout(input)

    expect(input.style.height).toBe('')
  })

  it('accepts an absent textarea during teardown', () => {
    expect(() => { repairSafariTextareaLayout(null) }).not.toThrow()
  })
})
