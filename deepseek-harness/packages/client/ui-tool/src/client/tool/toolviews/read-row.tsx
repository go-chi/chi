// Read toolview registrant: the keyed toolview hole for the read tool. The row
// composes the shared ToolRow (chrome, running sweep, whole-row expand) and
// feeds it the file's line-numbered, syntax-highlighted content as ToolRow's
// `read` card material, so it renders through ReadBlock in the collapsed-by-
// default expanded body — the same unified interaction every other card row
// has. The summary path is an openable host link. A running read (no result
// yet) and a non-read result render the summary row alone: the read intent is
// result-side only, so there is no running-state read card to draw.

import type { Context } from '@deepseek-ai/cordis'
import { IconBrowseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '../../contract/slots.ts'
import { readCardModel } from '../models/read-card-model.ts'
import { toolRowModel } from '../models/tool-call-model.ts'
import { ToolRow } from '../components/ToolRow.tsx'
import { CONVERSATION_NS as NS } from '../../locale.ts'

/** Full row props: the toolview runtime share plus the standard locale seat. */
type ReadRowProps = ToolCallViewProps & PropsLocale<'conversation'>

/**
 * Read row: icon + Read · {path} in the shared ToolRow chrome, with the file's
 * read card as the row's collapsed-by-default card body. The summary path is an
 * openable host link when the row names a single file.
 */
export function ReadRow({ toolName, block, cwd, openFile, inspect, t }: ReadRowProps) {
  const model = toolRowModel(toolName, block, cwd)
  const read = readCardModel(block, cwd)
  return (
    <ToolRow
      t={t}
      variant={model.variant}
      toolName={toolName}
      icon={<IconBrowseOutline16 size={14} />}
      title={model.title}
      summary={model.summary}
      body={null}
      output={model.output}
      errorSummary={model.errorSummary}
      read={read}
      state={model.state}
      filePath={model.filePath}
      onOpenFile={openFile}
      inspect={inspect}
    />
  )
}

/**
 * The read row as a plain registrant plugin following the atomic Tool-view
 * declaration across independent activation and reload lifetimes.
 */
export const readToolview = {
  name: 'read-toolview',
  inject: ['slots'],
  /**
   * Register the read row into the Tool-owned keyed view slot.
   * @param ctx - registrant context (disposal rides ctx.effect inside slots.register).
   */
  apply(ctx: Context): void {
    ctx.slots.inject('tool.call.toolview', () =>
      ctx.slots.register({ name: 'tool.call.toolview', key: 'read', locale: NS }, ReadRow))
  },
}
