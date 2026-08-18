// File-mutation toolview registrant: the keyed toolview hole for the `edit`
// and `write` tools. The row composes the shared ToolRow (chrome, running
// sweep, whole-row expand) and feeds it the applied diff as ToolRow's `diff`
// card material, so the change renders through DiffBlock in the collapsed-by-
// default expanded body — the same unified interaction every other card row
// has. The summary stays a path link (the file-tool interaction) that opens
// through the host; an errored mutation (write/edit return no diff on
// `result.isError`) keeps the model-facing error text on ToolRow's Output
// section, its first line in the collapsed summary.

import type { Context } from '@deepseek-ai/cordis'
import { IconEditOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '../../contract/slots.ts'
import { diffCardModel } from '../models/diff-card-model.ts'
import { toolRowModel } from '../models/tool-call-model.ts'
import { ToolRow } from '../components/ToolRow.tsx'
import { CONVERSATION_NS as NS } from '../../locale.ts'

/** Full row props: the toolview runtime share plus the standard locale seat. */
type FileMutationRowProps = ToolCallViewProps & PropsLocale<'conversation'>

/**
 * File-mutation row: icon + {Edit,Write} · {path} in the shared ToolRow chrome,
 * with the applied diff as the row's collapsed-by-default card body. The
 * summary is a path link (a file tool's interaction); the host's `openFile`
 * resolves it against the session cwd, so this passes the tool's own path
 * verbatim. An errored mutation has no diff card, so ToolRow surfaces the
 * model-facing error text through its Output section and its first line in the
 * collapsed summary instead.
 */
export function FileMutationRow({ toolName, block, cwd, openFile, inspect, t }: FileMutationRowProps) {
  const model = toolRowModel(toolName, block, cwd)
  const diff = diffCardModel(block)
  return (
    <ToolRow
      t={t}
      variant={model.variant}
      toolName={toolName}
      icon={<IconEditOutline16 size={14} />}
      title={model.title}
      summary={model.summary}
      body={null}
      output={model.output}
      errorSummary={model.errorSummary}
      diff={diff}
      state={model.state}
      filePath={model.filePath}
      onOpenFile={openFile}
      inspect={inspect}
    />
  )
}

/**
 * The file-mutation rows as a plain registrant plugin following the chat
 * toolview declaration across independent activation and reload lifetimes.
 */
export const fileMutationToolview = {
  name: 'file-mutation-toolview',
  inject: ['slots'],
  /**
   * Register the file-mutation row into the Tool-owned keyed view slot
   * under both mutation tool names.
   * @param ctx - registrant context (disposal rides ctx.effect inside slots.register).
   */
  apply(ctx: Context): void {
    ctx.slots.inject('tool.call.toolview', function* () {
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'edit', locale: NS }, FileMutationRow)
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'write', locale: NS }, FileMutationRow)
    })
  },
}
