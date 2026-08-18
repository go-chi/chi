import { clientOnly } from '../tsdown.client.ts'

/**
 * Root-shape lib build plus a css stub: the shell's components import
 * .module.css/.css assets that tsc passes through untouched, so the JS under
 * lib/types references css files that do not exist there. The browser
 * consumer (apps/web) compiles src directly through vite where css is real;
 * this node lib build stubs every css import to an empty module — importing
 * the lib under plain node must not crash on an asset specifier.
 */
export default clientOnly([{
  entry: ['lib/types/index.js', 'lib/types/invariant.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'neutral',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  plugins: [{
    name: 'dsh-css-stub',
    resolveId(source: string) {
      if (!source.endsWith('.css')) return null
      return `\0dsh-css-stub:${source}.mjs`
    },
    load(id: string) {
      if (!id.startsWith('\0dsh-css-stub:')) return null
      return 'export default {};'
    },
  }],
}])
