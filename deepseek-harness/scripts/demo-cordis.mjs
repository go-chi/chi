/**
 * Boot the self-referential Cordis tools under Web or ACP, defaulting to Web. This is a repository demo wrapper, not a product CLI feature.
 */
import { spawn } from 'node:child_process'

const SURFACES = new Map([
  // The browser surface with the cordis toolset layered on: `dsh web --config`
  // applies this overlay over the shipped web composition; it owns port 3081.
  ['web', ['--import', 'tsx', 'apps/cli/src/bin.ts', 'web', '--patch', 'examples/web-cordis/cordis.yml']],
  ['acp', ['--import', 'tsx', 'packages/examples/acp-demo/src/bin.ts', '--config', 'examples/acp-agent/cordis-tools.cordis.yml']],
])

const surface = process.argv[2] ?? 'web'
const args = SURFACES.get(surface)
if (args === undefined || process.argv.length > 3) {
  console.error('usage: pnpm run demo:cordis [web|acp]')
  process.exit(2)
}

if (surface === 'web') console.log('Cordis Web: http://127.0.0.1:3081')
const child = spawn(process.execPath, args, { stdio: 'inherit' })
child.on('exit', (code, signal) => { process.exit(signal === null ? code ?? 1 : 1) })
