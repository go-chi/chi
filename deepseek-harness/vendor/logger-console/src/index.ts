import { Formatter } from '@deepseek-ai/cordis'
import { inspect } from 'node:util'
import supportsColor from 'supports-color'
import { ConsoleExporter as Base } from './shared.ts'

/** Re-export shared console exporter config and base implementation. */
export * from './shared.ts'

const inspectFormatter: Formatter = (value, target) => {
  return inspect(value, { colors: !!target.colors, depth: Infinity, compact: true, breakLength: Infinity })
}

/** Node console exporter with `util.inspect` object formatting. */
export class ConsoleExporter extends Base {
  formatters: Record<string, Formatter> = {
    o: inspectFormatter,
    O: inspectFormatter,
  }

  getDefaults() {
    return {
      ...super.getDefaults(),
      colors: (supportsColor.stdout ? supportsColor.stdout.level : 0) as false | 0 | 1 | 2 | 3,
    }
  }
}

export default ConsoleExporter
