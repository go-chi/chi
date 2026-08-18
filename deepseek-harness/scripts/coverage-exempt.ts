/**
 * Heavy suites the coverage aggregate runs uninstrumented in a parallel gate.
 * Membership rule: a suite qualifies only when every coverage-measured
 * file it executes in-process (`coverage.include` spans package src trees;
 * typert generator src is threshold-excluded in vitest.config.ts) is already
 * fully covered by other suites, so removing it from the instrumented run
 * changes no threshold outcome. The aggregate still runs every listed suite
 * plain beside the instrumented gate, so correctness signal is unchanged —
 * only the v8 instrumentation tax on compiler- and subprocess-heavy fixtures
 * is dropped.
 */

/** One coverage-exempt suite: a Vitest CLI filter and its exclude glob. */
export interface CoverageExemptSuite {
  /** Positional file filter selecting the suite in the uninstrumented gate. */
  readonly filter: string
  /** Exclude glob removing the suite from the instrumented gate. */
  readonly exclude: string
}

/**
 * Set to `1` by the instrumented coverage gate; vitest.config.ts then drops
 * the exempt suites from every project. CLI `--exclude` cannot express this:
 * it does not reach per-project include resolution.
 */
export const COVERAGE_EXEMPT_ENV = 'DSH_COVERAGE_EXEMPT_HEAVY'

/** Coverage-exempt heavy suites; keep filter and exclude selecting the same files. */
export const coverageExemptHeavySuites: readonly CoverageExemptSuite[] = [
  // Whole-workspace compiler analysis per case — the lane's longest tail.
  // Generator src is threshold-excluded; tools-catalog's registry and
  // tool-cordis imports are fully covered by those packages' own tests.
  {
    filter: 'packages/typert/generator/tests/',
    exclude: 'packages/typert/generator/tests/**',
  },
  // Real child-process fixtures over scripts/ sources, which coverage never measures.
  { filter: 'scripts/install-lefthook.spec.ts', exclude: 'scripts/install-lefthook.spec.ts' },
  { filter: 'scripts/oxlint-contract.spec.ts', exclude: 'scripts/oxlint-contract.spec.ts' },
  { filter: 'scripts/change-scope.spec.ts', exclude: 'scripts/change-scope.spec.ts' },
  { filter: 'scripts/translation-pairing-merge.spec.ts', exclude: 'scripts/translation-pairing-merge.spec.ts' },
]
