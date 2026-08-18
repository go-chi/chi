import { describe, expect, it } from 'vitest'
import { partitionPairedMarkdownDerivatives } from './paired-markdown-derivatives.ts'

interface Block {
  doc: string
  kind: string
  code: string
}

const partition = (blocks: Block[]) => partitionPairedMarkdownDerivatives(
  blocks,
  block => block.doc,
  block => `${block.kind}\0${block.code}`,
)

describe('partitionPairedMarkdownDerivatives', () => {
  it('treats a complete byte-identical Chinese sequence as derivative', () => {
    const english = [
      { doc: 'docs/example.md', kind: 'ts', code: 'const one = 1' },
      { doc: 'docs/example.md', kind: 'type-equiv', code: 'interface Example {}' },
    ]
    const chinese = english.map(block => ({ ...block, doc: 'docs/example.zh.md' }))
    const unrelated = { doc: 'docs/other.md', kind: 'ts', code: 'const other = 2' }

    expect(partition([...english, ...chinese, unrelated])).toEqual({
      primary: [...english, unrelated],
      derivatives: chinese,
    })
  })

  it('keeps reordered, changed, partial, and orphan Chinese sequences primary', () => {
    const sequence = (doc: string) => [
      { doc, kind: 'ts', code: 'const one = 1' },
      { doc, kind: 'ts', code: 'const two = 2' },
    ]
    const english = sequence('docs/example.md')
    const changed = english.map((block, index) => ({
      ...block,
      doc: 'docs/example.zh.md',
      code: index === 0 ? 'const one = 0' : block.code,
    }))
    const reorderedEnglish = sequence('docs/reordered.md')
    const reordered = [...reorderedEnglish].reverse().map(block => ({ ...block, doc: 'docs/reordered.zh.md' }))
    const partialEnglish = sequence('docs/partial.md')
    const partial = [{ ...partialEnglish[0]!, doc: 'docs/partial.zh.md' }]
    const orphan = [{ doc: 'docs/orphan.zh.md', kind: 'ts', code: 'const orphan = true' }]
    const blocks = [
      ...english,
      ...changed,
      ...reorderedEnglish,
      ...reordered,
      ...partialEnglish,
      ...partial,
      ...orphan,
    ]

    expect(partition(blocks)).toEqual({ primary: blocks, derivatives: [] })
  })

  it('requires the fence kind to match as well as the body', () => {
    const english = { doc: 'docs/example.md', kind: 'type-equiv', code: 'interface Example {}' }
    const chinese = { ...english, doc: 'docs/example.zh.md', kind: 'public-api' }

    expect(partition([english, chinese])).toEqual({ primary: [english, chinese], derivatives: [] })
  })
})
