import { Message } from '@deepseek-ai/cordis'
import { ConsoleExporter as Base } from './shared.ts'

/** Re-export shared console exporter config and base implementation. */
export * from './shared.ts'

/** Browser console exporter that dispatches to native console methods. */
export class ConsoleExporter extends Base {
  export(message: Message) {
    const prefix = `[${message.type[0].toUpperCase()}] ${message.name}`
    const method = message.type === 'error' ? 'error' : message.type === 'warn' ? 'warn' : 'log'
    // eslint-disable-next-line no-console
    console[method](prefix, ...message.args)
  }
}

export default ConsoleExporter
