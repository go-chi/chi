/**
 * Keep Claude Code and Codex invocation metadata aligned for repository skills.
 * @module scripts/verify-skill-invocation-metadata
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { load } from 'js-yaml'

const ROOT = resolve(import.meta.dirname, '..')

/** Return an object-shaped YAML value, or undefined for every other shape. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** Parse a skill's YAML frontmatter as an object. */
function parseSkillFrontmatter(source: string): Record<string, unknown> {
  const lines = source.split('\n')
  if (lines[0] !== '---') throw new Error('SKILL.md must start with YAML frontmatter')
  const end = lines.indexOf('---', 1)
  if (end < 0) throw new Error('SKILL.md frontmatter is not closed')
  const metadata = asRecord(load(lines.slice(1, end).join('\n')))
  if (metadata === undefined) throw new Error('SKILL.md frontmatter must be a YAML object')
  return metadata
}

/** Find repository skill directories that carry Codex product metadata. */
function skillDirectories(root: string): string[] {
  const skillsRoot = resolve(root, '.agents/skills')
  if (!existsSync(skillsRoot)) return []
  return readdirSync(skillsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(resolve(skillsRoot, entry.name, 'agents/openai.yaml')))
    .map(entry => entry.name)
    .sort()
}

/**
 * Report cross-product invocation-policy mismatches for repository skills.
 * @param root - Repository root containing `.agents/skills`.
 * @returns diagnostics for malformed metadata or policies that expose a skill differently.
 */
export function collectSkillInvocationMetadataViolations(root: string): string[] {
  const violations: string[] = []

  for (const skill of skillDirectories(root)) {
    const relativeRoot = `.agents/skills/${skill}`
    const skillFile = resolve(root, relativeRoot, 'SKILL.md')
    const openaiFile = resolve(root, relativeRoot, 'agents/openai.yaml')
    if (!existsSync(skillFile)) {
      violations.push(`${relativeRoot}: agents/openai.yaml has no sibling SKILL.md`)
      continue
    }

    let frontmatter: Record<string, unknown>
    let openai: Record<string, unknown>
    try {
      frontmatter = parseSkillFrontmatter(readFileSync(skillFile, 'utf8'))
    }
    catch (error) {
      violations.push(`${relativeRoot}/SKILL.md: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    try {
      const parsed = asRecord(load(readFileSync(openaiFile, 'utf8')))
      if (parsed === undefined) throw new Error('agents/openai.yaml must be a YAML object')
      openai = parsed
    }
    catch (error) {
      violations.push(`${relativeRoot}/agents/openai.yaml: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }

    const disableModelInvocation = frontmatter['disable-model-invocation']
    if (disableModelInvocation !== undefined && typeof disableModelInvocation !== 'boolean') {
      violations.push(`${relativeRoot}/SKILL.md: disable-model-invocation must be a boolean`)
      continue
    }
    const userInvocable = frontmatter['user-invocable']
    if (userInvocable !== undefined && typeof userInvocable !== 'boolean') {
      violations.push(`${relativeRoot}/SKILL.md: user-invocable must be a boolean`)
      continue
    }

    const policy = asRecord(openai.policy)
    const allowImplicitInvocation = policy?.allow_implicit_invocation
    if (allowImplicitInvocation !== undefined && typeof allowImplicitInvocation !== 'boolean') {
      violations.push(`${relativeRoot}/agents/openai.yaml: policy.allow_implicit_invocation must be a boolean`)
      continue
    }

    const claudeManualOnly = disableModelInvocation === true
    const codexManualOnly = allowImplicitInvocation === false
    if (claudeManualOnly !== codexManualOnly) {
      violations.push(
        `${relativeRoot}: Claude Code manual-only=${String(claudeManualOnly)}`
        + ` but Codex manual-only=${String(codexManualOnly)}`,
      )
    }
    if (claudeManualOnly && userInvocable === false) {
      violations.push(`${relativeRoot}/SKILL.md: a manual-only skill must remain user-invocable`)
    }
  }

  return violations
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  const skills = skillDirectories(ROOT)
  const violations = collectSkillInvocationMetadataViolations(ROOT)
  if (violations.length > 0) {
    process.stderr.write('verify-skill-invocation-metadata: violations found:\n')
    for (const violation of violations) process.stderr.write(`  ${violation}\n`)
    process.exit(1)
  }

  process.stdout.write(
    `verify-skill-invocation-metadata: ${String(skills.length)} cross-product skill policy pair(s) aligned.\n`,
  )
}
