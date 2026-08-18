import { describe, expect, it } from 'vitest'
import { normalizeTerminalText, TerminalSanitizer } from '@deepseek-ai/dsh-terminal-bash/src/sanitize.ts'

describe('TerminalSanitizer', () => {
  it('removes split CSI and owned OSC prompt markers', () => {
    const sanitizer = new TerminalSanitizer(64)
    expect(sanitizer.push('red\x1b[3')).toEqual({ text: 'red', prompt: false })
    expect(sanitizer.push('1m text\x1b[0m\r\n')).toEqual({ text: ' text\n', prompt: false })
    expect(sanitizer.push('\x1b]133;')).toEqual({ text: '', prompt: false })
    expect(sanitizer.push('D;0\x07dsh> ')).toEqual({ text: 'dsh> ', prompt: true, promptTail: 'dsh> ' })
  })

  it('drops unrelated OSC, short escapes, BEL, and incomplete trailing escape', () => {
    const sanitizer = new TerminalSanitizer(64)
    expect(sanitizer.push('a\x1b]0;title\x1b\\b\x1b7c\x07')).toEqual({ text: 'abc', prompt: false })
    expect(sanitizer.push('tail\x1b')).toEqual({ text: 'tail', prompt: false })
    expect(sanitizer.flush()).toBe('')
    expect(sanitizer.flush()).toBe('')
    expect(sanitizer.push('\x1b]0;one\x07middle\x1b\\')).toEqual({ text: 'middle', prompt: false })
    expect(sanitizer.push('\x1b]0;one\x1b\\middle\x07')).toEqual({ text: 'middle', prompt: false })
    expect(sanitizer.push('\x1b]0;title\x1b\\')).toEqual({ text: '', prompt: false })
  })

  it('normalizes CRLF and standalone carriage returns', () => {
    expect(normalizeTerminalText('a\r\nb\rc\x07')).toBe('a\nb\nc')
  })

  it('carries a trailing carriage return across data chunks and flushes standalone CR', () => {
    const sanitizer = new TerminalSanitizer(64)
    expect(sanitizer.push('a\r')).toEqual({ text: 'a', prompt: false })
    expect(sanitizer.push('\nb')).toEqual({ text: '\nb', prompt: false })
    expect(sanitizer.push('\r')).toEqual({ text: '', prompt: false })
    expect(sanitizer.flush()).toBe('\n')
  })

  it('reports printable prompt text that follows a marker in a later chunk', () => {
    const sanitizer = new TerminalSanitizer(64)
    expect(sanitizer.push('\x1b]133;D;0\x07')).toEqual({ text: '', prompt: true, promptTail: '' })
    expect(sanitizer.push('dsh> ')).toEqual({ text: 'dsh> ', prompt: false, promptTail: 'dsh> ' })
  })

  it('bounds and discards unterminated control sequences through their terminators', () => {
    const oscBel = new TerminalSanitizer(8)
    expect(oscBel.push(`\x1b]0;${'x'.repeat(16)}`)).toEqual({ text: '', prompt: false })
    expect(oscBel.push('more\x07tail')).toEqual({ text: 'tail', prompt: false })

    const oscSt = new TerminalSanitizer(8)
    oscSt.push(`\x1b]0;${'x'.repeat(16)}`)
    expect(oscSt.push('more\x1b')).toEqual({ text: '', prompt: false })
    expect(oscSt.push('\\tail')).toEqual({ text: 'tail', prompt: false })

    const oscDirectSt = new TerminalSanitizer(8)
    oscDirectSt.push(`\x1b]0;${'x'.repeat(16)}`)
    expect(oscDirectSt.push('more\x1b\\tail')).toEqual({ text: 'tail', prompt: false })

    const oscFalseSt = new TerminalSanitizer(8)
    oscFalseSt.push(`\x1b]0;${'x'.repeat(16)}`)
    oscFalseSt.push('\x1b')
    expect(oscFalseSt.push('more')).toEqual({ text: '', prompt: false })
    expect(oscFalseSt.push('\x07tail')).toEqual({ text: 'tail', prompt: false })

    const oscNonTerminatingEscape = new TerminalSanitizer(8)
    oscNonTerminatingEscape.push(`\x1b]0;${'x'.repeat(16)}`)
    expect(oscNonTerminatingEscape.push('more\x1bxmore\x07tail')).toEqual({ text: 'tail', prompt: false })

    const csi = new TerminalSanitizer(8)
    expect(csi.push(`\x1b[${'1'.repeat(16)}`)).toEqual({ text: '', prompt: false })
    expect(csi.push('123')).toEqual({ text: '', prompt: false })
    expect(csi.push('mtext')).toEqual({ text: 'text', prompt: false })

    const flushed = new TerminalSanitizer(8)
    flushed.push(`\x1b]0;${'x'.repeat(16)}`)
    expect(flushed.flush()).toBe('')
    expect(flushed.push('text')).toEqual({ text: 'text', prompt: false })
  })
})
