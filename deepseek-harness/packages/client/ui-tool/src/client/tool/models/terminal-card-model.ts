/**
 * Pure derivation of the terminal-card props from a frozen call slice: the
 * `card:'terminal'` render intent the shell tools declare arrives on the
 * snapshot as `callView`/`resultView`, and this is the one place that turns
 * that pair into what {@link TerminalBlock} draws. Both conversation render
 * sites (the chat tool row's expanded body and the details panel's Output
 * section) call this, so the command, cwd, output and exit status they show
 * are derived once.
 * @module
 */
import { resolveWorkspacePath } from '@deepseek-ai/dsh-client-runtime/client'
import type { TerminalBlockLabels, TerminalBlockProps } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallBlock } from './tool-call-model.ts'

/**
 * Build the TerminalBlock display copy from the conversation locale seat —
 * the one place the primitive's label surface pairs with this package's
 * dictionary, shared by every terminal render site (chat row, bash row,
 * details panel).
 * @param t - the render site's conversation locale seat.
 * @returns the full label set for {@link TerminalBlockProps}'s `labels`.
 */
export function terminalBlockLabels(t: TranslateNS<'conversation'>): TerminalBlockLabels {
  return {
    signal: signal => t('terminal.signal', { signal }),
    exitCode: code => t('terminal.exitCode', { code }),
    running: t('terminal.running'),
    failed: t('terminal.failed'),
    done: t('terminal.done'),
    copy: t('copy'),
    copied: t('copied'),
    noOutput: t('terminal.noOutput'),
    collapseAria: t('terminal.collapseAria'),
    collapse: t('collapse'),
    expandAria: hidden => t('terminal.expandAria', { n: hidden }),
    expand: hidden => t('terminal.expandRest', { n: hidden }),
  }
}

/**
 * The {@link TerminalBlock} props this derivation owns. Picked off the
 * primitive's props so the two stay in step; `home` is absent because the web
 * client has no home path for the session host (a cwd renders as its last
 * path segment), and `maxLines`/`className` belong to each render site.
 */
export interface TerminalCardModel {
  /**
   * The props {@link TerminalBlock} draws. Held as a nested object so a render
   * site spreads exactly the primitive's own surface and can never leak a
   * neighbouring field into it.
   */
  card: Pick<TerminalBlockProps, 'command' | 'cwd' | 'output' | 'exitCode' | 'signal' | 'running'>
  /**
   * The call view's model-authored description, which the contract defines as
   * rendering ABOVE the card (the card itself has no description slot). Absent
   * when the presenter supplied none, or when the window dropped the call side;
   * a row then keeps its args-derived summary.
   */
  description: string | undefined
}

/**
 * True when a settled terminal card reports a failing exit — a non-zero code
 * or a terminating signal. The bash tool settles a failing command as a
 * completed call (`isError` stays false: the exit status is result data), so
 * this is the collapsed row's only failure signal; without it the red exit
 * pill would be visible only after expanding the card.
 * @param model - a derived terminal card.
 * @returns whether the card's exit status is a failure.
 */
export function terminalFailed(model: TerminalCardModel): boolean {
  const { exitCode, signal, running } = model.card
  return running !== true && ((exitCode !== undefined && exitCode !== 0) || signal !== undefined)
}

/**
 * Resolve a terminal view's working directory the way the render-intent
 * contract assigns to the UI bridge: an absolute path is used as-is, a relative
 * one joins under the session workspace, and an omitted one IS the session
 * workspace. A pure presenter cannot see the session cwd, which is why this
 * resolution belongs here rather than in the tool. Without a session cwd there
 * is nothing to resolve against, so a relative path stays as authored and an
 * omitted one stays absent (the prompt row then draws a bare `$`).
 * @param viewCwd - the cwd the terminal call view carries, if any.
 * @param sessionCwd - the session workspace root, if the caller knows it.
 * @returns the working directory for the prompt label, or undefined.
 */
function resolveTerminalCwd(viewCwd: string | undefined, sessionCwd: string | undefined): string | undefined {
  if (viewCwd === undefined || viewCwd === '') return sessionCwd
  if (sessionCwd === undefined || sessionCwd === '') return normalizeSegments(viewCwd)
  return normalizeSegments(resolveWorkspacePath(sessionCwd, viewCwd))
}

/**
 * Collapse `.` and `..` segments so the prompt label names the directory the
 * command actually ran in. The bash executor resolves the workdir before
 * running, so a joined `/w/app/..` must display as `w`, not as `..`. Separators
 * are preserved as authored (a Windows path keeps its backslashes) because this
 * value is only ever displayed; a `..` that would climb past the root is
 * dropped, which is what a filesystem does with it. A UNC path's `server` and
 * `share` are part of its root, not poppable segments: Windows cannot climb
 * above a share, so `\\\\server\\share` with a `..` stays there.
 * @param path - a joined or absolute path, possibly carrying `.`/`..` segments.
 * @returns the same path with those segments resolved.
 */
function normalizeSegments(path: string): string {
  if (!/(?:^|[/\\])\.\.?(?:[/\\]|$)/.test(path)) return path
  // A UNC path is `\\\\server\\share\\...`: the server and share form the root,
  // so they are split off here and neither is a segment `..` may pop. Its
  // separator is fixed to a backslash, since a joined relative part may have
  // introduced a forward slash that UNC syntax does not use.
  const unc = /^[/\\]{2}([^/\\]+)[/\\]+([^/\\]+)/.exec(path)
  if (unc !== null) {
    // Both groups are mandatory in the pattern, so destructuring types them as
    // strings without an assertion.
    const [matched, server, share] = unc
    const root = `\\\\${String(server)}\\${String(share)}`
    // Rooted: what follows the share hangs off it, so a `..` at the top is
    // dropped rather than kept — Windows cannot climb above a share.
    const rest = collapse(path.slice(matched.length), true)
    return rest === '' ? root : `${root}\\${rest}`
  }
  const backslashed = path.includes('\\') && !path.includes('/')
  const separator = backslashed ? '\\' : '/'
  const rooted = /^[/\\]/.test(path)
  const drive = /^[A-Za-z]:/.exec(path)?.[0] ?? ''
  const body = collapse(path.slice(drive.length), rooted || drive !== '', separator)
  const leading = rooted ? separator : ''
  return drive === '' ? `${leading}${body}` : `${drive}${rooted ? leading : separator}${body}`
}

/**
 * Collapse the `.`/`..` segments of a path body against a known root state.
 * @param body - the path after any drive letter or UNC root.
 * @param rooted - the body hangs off a root, so a `..` at its top is dropped
 *   the way a filesystem drops one; without a root the `..` is kept, since it
 *   stays meaningful against a cwd this function cannot see.
 * @param separator - separator to rejoin with (default `/`).
 * @returns the collapsed body, without leading or trailing separators.
 */
function collapse(body: string, rooted: boolean, separator = '/'): string {
  const kept: string[] = []
  for (const segment of body.split(/[/\\]/)) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (kept.length > 0 && kept[kept.length - 1] !== '..') kept.pop()
      else if (!rooted) kept.push(segment)
      continue
    }
    kept.push(segment)
  }
  return kept.join(separator)
}

/**
 * Derive the terminal-card props for a tool call, or null when this call is
 * not a terminal card and belongs on the generic path.
 *
 * The call side supplies the command and its working directory; the result
 * side supplies the captured output and exit status. Three cases produce
 * null, all of them the documented generic-card default:
 *
 * - Neither side declares `card:'terminal'` — including a `card` value this
 *   UI version does not know, which arrives over the wire and therefore
 *   cannot be trusted to be one of the compiled variants.
 * - A settled call whose result view is not a terminal card: the result
 *   presentation decides how the settled call renders, and the bash tool
 *   returns a generic fenced card for an execution error or a background
 *   start, whose text and error styling the generic path preserves.
 *
 * Window truncation can drop the call head from a settled result (see
 * `ToolResultNode.call`/`callView` in dsh-client-runtime), leaving a terminal
 * result with no call side. That still renders: the command falls back to the
 * result view's replacement title, then to an empty command (the prompt line
 * draws bare), and the prompt shows no cwd.
 * @param block - RunningToolCall or ToolResultNode off the snapshot caches.
 * @param sessionCwd - the session workspace root, which resolves an omitted or
 *   relative view cwd (see {@link resolveTerminalCwd}); absent leaves both unresolved.
 * @returns the terminal-card props, or null for the generic path.
 */
export function terminalCardModel(block: ToolCallBlock, sessionCwd?: string): TerminalCardModel | null {
  const call = block.callView?.card === 'terminal' ? block.callView : null
  if (!('kind' in block)) {
    // Running: the call view exists, the result view does not yet.
    return call === null ? null : {
      description: call.description,
      card: {
        command: call.title,
        cwd: resolveTerminalCwd(call.cwd, sessionCwd),
        output: undefined,
        exitCode: undefined,
        signal: undefined,
        running: true,
      },
    }
  }
  const result = block.resultView?.card === 'terminal' ? block.resultView : null
  if (result === null) return null
  return {
    description: call?.description,
    card: {
      // The result's title REPLACES the pending one when the tool supplies it
      // (the presentation contract's replacement-title rule); the call title is
      // what a result without one keeps.
      command: result.title ?? call?.title ?? '',
      // Only a PRESENT call view can mean "omitted the cwd, so use the
      // workspace". When the window dropped the call head there is no cwd
      // anywhere — the result view carries none — and the original call may
      // well have used an explicit workdir, so the prompt draws a bare `$`
      // rather than naming a directory this card cannot know.
      cwd: call === null ? undefined : resolveTerminalCwd(call.cwd, sessionCwd),
      output: result.output,
      exitCode: result.exitCode,
      signal: result.signal,
      running: false,
    },
  }
}
