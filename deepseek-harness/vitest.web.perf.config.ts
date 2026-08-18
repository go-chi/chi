import { defineConfig } from 'vitest/config'
import webConfig from './vitest.web.config.ts'

// Manual high-cardinality diagnostics stay outside vitest.web.config.ts's
// .e2e.ts/.snapshot.ts inventory and therefore outside the CI web gate.
export default defineConfig({
  ...webConfig,
  test: {
    ...webConfig.test,
    include: ['apps/web/tests/**/*.perf.ts'],
    disableConsoleIntercept: true,
    hookTimeout: 180_000,
    testTimeout: 600_000,
  },
})
