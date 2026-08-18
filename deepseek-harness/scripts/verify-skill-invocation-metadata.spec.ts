import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectSkillInvocationMetadataViolations } from './verify-skill-invocation-metadata.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-skill-invocation-metadata-'))
  roots.push(root)
  return root
}

function writeSkill(root: string, name: string, frontmatter: string, policy = ''): void {
  const directory = join(root, '.agents/skills', name)
  mkdirSync(join(directory, 'agents'), { recursive: true })
  writeFileSync(join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: Test skill\n${frontmatter}---\n\nTest.\n`)
  writeFileSync(
    join(directory, 'agents/openai.yaml'),
    `interface:\n  display_name: "Test"\n${policy}`,
  )
}

describe('cross-product skill invocation metadata gate', () => {
  it('accepts aligned default and manual-only policies', () => {
    const root = fixtureRoot()
    writeSkill(root, 'default-skill', '')
    writeSkill(
      root,
      'manual-skill',
      'disable-model-invocation: true\nuser-invocable: true\n',
      'policy:\n  allow_implicit_invocation: false\n',
    )

    expect(collectSkillInvocationMetadataViolations(root)).toEqual([])
  })

  it('rejects either direction of a manual-only policy mismatch', () => {
    const root = fixtureRoot()
    writeSkill(root, 'claude-only', 'disable-model-invocation: true\n')
    writeSkill(root, 'codex-only', '', 'policy:\n  allow_implicit_invocation: false\n')

    expect(collectSkillInvocationMetadataViolations(root)).toEqual([
      '.agents/skills/claude-only: Claude Code manual-only=true but Codex manual-only=false',
      '.agents/skills/codex-only: Claude Code manual-only=false but Codex manual-only=true',
    ])
  })
})
