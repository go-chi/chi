#!/usr/bin/env node
/**
 * Temporary branch-convergence command for canonical packed session fixtures.
 *
 * @see ../.agents/notes/proposed/process/2026-07-26-remove-packed-session-fixture-migrator.md
 */

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { inspectSessionFixtureLayouts } from './session-fixture-layout.ts'

if (process.argv.length > 2) throw new Error('migrate:packed-session-fixtures takes no arguments')

const root = resolve(import.meta.dirname, '..')
const fixtures = inspectSessionFixtureLayouts(root)
const changed = fixtures.filter(fixture => fixture.source !== fixture.canonical)
for (const fixture of changed) {
  writeFileSync(resolve(root, fixture.path), fixture.canonical)
  console.log(fixture.path)
}
console.log(`packed session fixtures: ${changed.length} rewritten, ${fixtures.length} inspected`)
