/**
 * Shared rendering helpers for the shell tools (`dsh-tool-bash`,
 * `dsh-tool-pwsh`): the exit-status marker contract the tools' renderers
 * emit and the presentation layer parses back.
 * @module @deepseek-ai/dsh-shell/render
 */

/**
 * The exit status recovered from a rendered result, with the output body that
 * status was split off from.
 */
export type ParsedExitStatus =
  & { body: string }
  & ({ exitCode: number } | { signal: string })

/**
 * Split a rendered shell-tool result string into its output body and the
 * structured exit status — the inverse of the `[exit code: N]` /
 * `[killed by signal: X]` markers the shell tools' renderers append. A killed
 * marker yields `signal`; otherwise a non-zero marker yields `exitCode`;
 * absent both means a clean exit 0.
 *
 * The consumed marker is removed from `body` because a terminal presentation
 * shows the exit status as its own pill: leaving the marker in the output
 * would render the exit twice. Other markers (timeout, sandbox denial) carry
 * facts no pill shows, so they stay in the body.
 *
 * Replay only retains the rendered content text, not the original
 * `ShellRunResult`, so terminal presentation must recover the exit pill here.
 * Requiring a leading newline and the end of the string keeps ordinary output
 * that merely ends with marker-like text from matching unless the final line
 * is indistinguishable from a real marker.
 * @param text - rendered model-facing shell-tool result.
 * @returns the marker-free body plus the recovered terminal exit code or signal.
 */
export function parseExitStatus(text: string): ParsedExitStatus {
  const signal = /\n\[killed by signal: ([^\]\n]+)\]$/.exec(text)
  if (signal?.[1] !== undefined) return { body: text.slice(0, signal.index), signal: signal[1] }
  const exit = /\n\[exit code: (\d+)\]$/.exec(text)
  if (exit?.[1] !== undefined) return { body: text.slice(0, exit.index), exitCode: Number(exit[1]) }
  return { body: text, exitCode: 0 }
}
