/** Boot the ACP Code Mode overlay. Requires a DeepSeek API key. */
import { spawn } from 'node:child_process'

if (process.argv.length > 2) {
  console.error('usage: pnpm run demo:code-mode')
  process.exit(2)
}

const child = spawn(process.execPath, [
  '--import',
  'tsx',
  'packages/examples/acp-demo/src/bin.ts',
  '--config',
  'examples/acp-agent/code-mode.cordis.yml',
], { stdio: 'inherit' })
child.on('exit', (code, signal) => { process.exit(signal !== null ? 1 : code ?? 1) })
