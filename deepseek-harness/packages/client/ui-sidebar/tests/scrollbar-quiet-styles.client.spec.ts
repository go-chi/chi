/**
 * The quiet-column rule as CSS text: the state SidebarRoot toggles
 * (pointer-scrollbars.spec.tsx) hides a scrollbar only through this rule, and
 * ui-theme's gate checks the rebinding contract's shape without knowing which
 * sheet states which half.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/SidebarRoot.module.css', import.meta.url)), 'utf8')
/** Declarations only: the sheet's prose names the properties it explains. */
const declarationText = css.replace(/\/\*[\s\S]*?\*\//g, ' ')

describe('SidebarRoot.module.css quiet column', () => {
  it('rebinds the ui-theme indirection pair to transparent', () => {
    // The pair, not the resting thumb alone: rebinding one leaves the other
    // painting its base-surface colour the moment the pointer reaches the bar.
    const rule = /\.root\.quietBars\s*\{([^{}]*)\}/.exec(declarationText)
    expect(rule).not.toBeNull()
    const declarations = (rule![1] ?? '').split(';').map(part => part.trim()).filter(Boolean).sort()
    expect(declarations).toEqual([
      '--dsh-scrollbar-thumb-hover: transparent',
      '--dsh-scrollbar-thumb: transparent',
    ].sort())
  })

  it('leaves the gutter reservation to the scrolling region', () => {
    // Hiding the thumb must not move a row: the reservation lives on the list
    // (ui-workspace), so the column states colour only.
    expect(declarationText).not.toMatch(/scrollbar-gutter/)
  })
})
