/** Verify package-owned invariant source and publication rules. */

import { resolve } from 'node:path'
import {
  collectPackageInvariantViolations,
  formatPackageInvariantViolation,
  packageInvariantOwners,
} from './package-invariants.ts'

const root = resolve(import.meta.dirname, '..')
const violations = collectPackageInvariantViolations(root)

if (violations.length > 0) {
  console.error('verify-package-invariants: violations found:')
  for (const violation of violations) {
    console.error(`  ${formatPackageInvariantViolation(root, violation)}`)
  }
  process.exit(1)
}

console.log(`verify-package-invariants: ${packageInvariantOwners(root).length} hand-owned package companion(s) conform.`)
