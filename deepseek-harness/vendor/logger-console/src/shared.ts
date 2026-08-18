import { Context, Exporter, Formatter, Logger, Message } from '@deepseek-ai/cordis'
import { Time } from '@deepseek-ai/cosmokit'
import z from '@deepseek-ai/schemastery'

/** Terminal color support level compatible with supports-color. */
export type ColorSupportLevel = 0 | 1 | 2 | 3

/** Formatting options for the logger name label. */
export interface LabelStyle {
  width?: number
  margin?: number
  align?: 'left' | 'right'
}

/** Config namespace for console logger exporters. */
export namespace ConsoleExporter {
  export interface Config {
    colors?: false | ColorSupportLevel
    maxLength?: number
    levels?: Record<string, number>
    showDiff?: boolean
    showTime?: string
    label?: LabelStyle
  }
}

/** Shared console log exporter implementation used by Node and browser builds. */
export class ConsoleExporter implements Exporter {
  static readonly name = 'logger-console'

  static readonly Config: z<ConsoleExporter.Config> = z.object({
    colors: z.union([z.const(false), z.number()]),
    maxLength: z.number(),
    levels: z.dict(z.number()),
    showDiff: z.boolean().default(false),
    showTime: z.string().default('yyyy-MM-dd hh:mm:ss '),
    label: z.object({
      width: z.number(),
      margin: z.number(),
      align: z.union(['left', 'right']),
    }),
  }) as z<ConsoleExporter.Config>

  colors!: false | ColorSupportLevel
  maxLength?: number
  levels?: Record<string, number>
  showDiff!: boolean
  showTime!: string
  label?: LabelStyle
  timestamp: number

  formatters: Record<string, Formatter> = {}

  constructor(public ctx: Context, config: ConsoleExporter.Config = {}) {
    Object.assign(this, this.getDefaults(), config)
    this.timestamp = Date.now()
    ctx.logger.exporter(this)
  }

  getDefaults() {
    return {
      colors: false as false | ColorSupportLevel,
      showTime: 'yyyy-MM-dd hh:mm:ss ',
      showDiff: false,
    }
  }

  export(message: Message) {
    // eslint-disable-next-line no-console
    console.log(this.render(message))
  }

  render(message: Message) {
    const prefix = `[${message.type[0].toUpperCase()}]`
    const space = ' '.repeat(this.label?.margin ?? 1)
    let indent = 3 + space.length, output = ''
    if (this.showTime) {
      indent += this.showTime.length
      output += Logger.color(this, 8, Time.template(this.showTime))
    }
    const code = Logger.code(message.name, this.colors)
    const label = Logger.color(this, code, message.name, ';1')
    const padLength = (this.label?.width ?? 0) + label.length - message.name.length
    if (this.label?.align === 'right') {
      output += label.padStart(padLength) + space + prefix + space
      indent += (this.label.width ?? 0) + space.length
    } else {
      output += prefix + space + label.padEnd(padLength) + space
    }
    output += Logger.format(this, message).replace(/\n/g, '\n' + ' '.repeat(indent))
    if (this.showDiff && this.timestamp) {
      const diff = message.ts - this.timestamp
      output += Logger.color(this, code, ' +' + Time.format(diff))
    }
    this.timestamp = message.ts
    return output
  }
}

export default ConsoleExporter
