import { describe, expect, it } from 'vitest'
import { findUnavailableRepositoryReferences } from './verify-public-repository-links.ts'

describe('repository link policy', () => {
  it('rejects encoded and case-varied references to the unavailable repository', () => {
    const unavailableOwner = ['deepseek', 'ai'].join('-')
    const unavailableName = ['deepseek', 'harness', 'sdk'].join('-')
    const unavailableRepository = `${unavailableOwner}/${unavailableName}`
    const encodedRepository = unavailableRepository.replaceAll('-', '%2D').replace('/', '%2F')
    const htmlEncodedRepository = unavailableRepository.replace('/', '&#x2f;')
    const jsonEscapedRepository = unavailableRepository.replace('/', '\\/')
    const unicodeEscapedRepository = unavailableRepository.replace('/', String.raw`\u002f`)
    const source = [
      'https://github.com/deepseek-ai/deepseek-harness',
      `https://github.com/${unavailableRepository.toUpperCase()}/issues/1`,
      `https://github.com/${encodedRepository}/issues/2`,
      `https://github.com/${htmlEncodedRepository}/issues/3`,
      `"https:\\/\\/github.com\\/${jsonEscapedRepository}\\/issues\\/4"`,
      `"https:\\/\\/github.com\\/${unicodeEscapedRepository}\\/issues\\/5"`,
      `https://github.com/${unavailableOwner}/cordis`,
      `https://github.com/example/${unavailableName}`,
    ].join('\n')

    expect(findUnavailableRepositoryReferences('subject.md', source)).toEqual([
      { file: 'subject.md', line: 2 },
      { file: 'subject.md', line: 3 },
      { file: 'subject.md', line: 4 },
      { file: 'subject.md', line: 5 },
      { file: 'subject.md', line: 6 },
    ])
  })

  it('preserves frozen archived Agent Notes', () => {
    const unavailableRepository = ['deepseek-ai', 'deepseek-harness-sdk'].join('/')

    expect(findUnavailableRepositoryReferences(
      '.agents/notes/archived/process/historical-record.md',
      `https://github.com/${unavailableRepository}`,
    )).toEqual([])
    expect(findUnavailableRepositoryReferences(
      '.agents/notes/implemented/process/active-record.md',
      `https://github.com/${unavailableRepository}`,
    )).toEqual([{ file: '.agents/notes/implemented/process/active-record.md', line: 1 }])
  })
})
