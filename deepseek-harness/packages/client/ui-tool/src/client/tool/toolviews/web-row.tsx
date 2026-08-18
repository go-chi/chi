// Web toolview registrant: the keyed toolview hole for the `web_search` and
// `web_fetch` tools. Registered under BOTH, since both declare the one `web`
// render intent and render through the one WebBlock family; the row
// discriminates on the toolName only to pick its icon and title. The row
// composes the shared ToolRow (chrome, running sweep, whole-row expand) and
// feeds it the completed retrieval as ToolRow's `web` card material, so it
// renders through WebBlock in the collapsed-by-default expanded body — the same
// unified interaction every other card row has. Until the call settles there is
// no web card (the tools keep a generic pending view), so a running row is the
// summary line alone.

import type { Context } from '@deepseek-ai/cordis'
import { IconBrowseOutline16, IconGlobeOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '../../contract/slots.ts'
import { webCardModel } from '../models/web-card-model.ts'
import { toolRowModel } from '../models/tool-call-model.ts'
import { ToolRow } from '../components/ToolRow.tsx'
import { CONVERSATION_NS as NS } from '../../locale.ts'

/** Full row props: the toolview runtime share plus the standard locale seat. */
type WebRowProps = ToolCallViewProps & PropsLocale<'conversation'>

/** web_fetch reads one URL; web_search queries. Titles are figma literals. */
const WEB_TITLES: Record<string, string> = {
  web_search: 'Search',
  web_fetch: 'Fetch',
}

/**
 * Web row: icon + Search/Fetch · {summary} in the shared ToolRow chrome, with
 * the completed retrieval's web card as the row's collapsed-by-default card
 * body. The row discriminates on `toolName` only to pick its icon and title.
 */
export function WebRow({ toolName, block, inspect, t }: WebRowProps) {
  const model = toolRowModel(toolName, block)
  const web = webCardModel(block)
  // Web search uses a globe; local grep/glob keep the magnifier family.
  const icon = toolName === 'web_fetch' ? <IconBrowseOutline16 size={14} /> : <IconGlobeOutline14 size={14} />
  return (
    <ToolRow
      t={t}
      variant={model.variant}
      toolName={toolName}
      icon={icon}
      title={WEB_TITLES[toolName] ?? model.title}
      summary={model.summary}
      body={null}
      output={model.output}
      errorSummary={model.errorSummary}
      web={web}
      state={model.state}
      inspect={inspect}
    />
  )
}

/**
 * The web rows follow the atomic Tool-view declaration across activation and
 * reload. One WebRow component registers under both web tool names.
 */
export const webToolview = {
  name: 'web-toolview',
  inject: ['slots'],
  /**
   * Register the web row under both web tool names' keyed toolview holes.
   * @param ctx - registrant context (disposal rides ctx.effect inside slots.register).
   */
  apply(ctx: Context): void {
    ctx.slots.inject('tool.call.toolview', function* () {
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'web_search', locale: NS }, WebRow)
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'web_fetch', locale: NS }, WebRow)
    })
  },
}
