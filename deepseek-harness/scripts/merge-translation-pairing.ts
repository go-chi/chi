/** Git merge-driver and explicit conflict-resolver entrypoint for pairing records. */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import {
  mergeTranslationPairingRecords,
  resolveTranslationPairingConflicts,
} from './translation-pairing-merge.ts'

const args = process.argv.slice(2)

try {
  if (args[0] === '--probe') {
    if (args.length !== 1) throw new Error('--probe takes no other arguments')
  } else {
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
    if (args[0] === '--resolve') {
      if (args.length !== 1) throw new Error('--resolve takes no paths; it inspects the unmerged index')
      const resolved = resolveTranslationPairingConflicts(root)
      if (resolved.length === 0) {
        console.log('merge-translation-pairing: no unresolved pairing records')
      } else {
        for (const path of resolved) console.log(`merge-translation-pairing: resolved ${path}`)
      }
    } else {
      if (args.length !== 4) {
        throw new Error('merge-driver mode requires <ancestor> <current> <other> <repository-path>')
      }
      const [ancestorPath, currentPath, otherPath, metaPath] = args
      if (ancestorPath === undefined || currentPath === undefined || otherPath === undefined || metaPath === undefined) {
        throw new Error('merge-driver arguments are incomplete')
      }
      const result = mergeTranslationPairingRecords(
        root,
        metaPath,
        readFileSync(ancestorPath, 'utf8'),
        readFileSync(currentPath, 'utf8'),
        readFileSync(otherPath, 'utf8'),
      )
      writeFileSync(currentPath, result.record)
    }
  }
} catch (error) {
  console.error(`merge-translation-pairing: ${error instanceof Error ? error.message : String(error)}`)
  console.error(
    'merge-translation-pairing: resolve owner conflicts, then confirm the pair with '
    + '`pnpm run verify-translation-pairing --write <pair>`; rerun '
    + '`pnpm run resolve-translation-pairing-conflicts` for other safe records',
  )
  process.exitCode = 1
}
