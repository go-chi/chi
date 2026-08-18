import { defineConfig } from 'tsdown'

/**
 * logger-console ships two entries: the node exporter (index) and the
 * browser exporter (browser), selected via package.json `exports`
 * conditions. The entries are JS emitted by tsc under lib/types and are
 * bundled as two single-entry passes so the shared base class is inlined into
 * each (matching upstream's published shape) instead of split into a hash-named
 * chunk.
 */
const shared = {
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
} as const

export default defineConfig([
  { ...shared, entry: ['lib/types/index.js'] },
  { ...shared, entry: ['lib/types/browser.js'] },
])
