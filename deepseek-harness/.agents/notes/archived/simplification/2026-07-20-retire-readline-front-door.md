# Agent Note: Retire the readline front door and the repl-agent example

Status: implemented
Archived: 2026-07-26

English | [中文](2026-07-20-retire-readline-front-door.zh.md)

## Problem

The repo shipped two interactive terminal front doors: the line-oriented readline channel (`@deepseek-ai/dsh-stdio`) and the full-screen [`@deepseek-ai/dsh-tui`](../feature/2026-07-17-dedicated-full-screen-tui-front-door.md). After the TUI landed, readline's interactive role was redundant — `demo:tui` superseded `demo:repl` as the coding-agent experience — while its remaining real role, pipes and automation, was already served better by the one-shot `@deepseek-ai/dsh-cli-demo` app (task in, DSH-native `text`/`json`/`stream-json` out, durable persistence, signal handling).

The duplication was structural, not just cosmetic: `dsh-stdio-demo` carried a `TerminalMode` (`auto`/`readline`/`tui`) selection seam, ~1,000 lines of readline unit tests, a readline transcript grammar (`[tool call] …` lines) that the CI demo smoke and two built-bin e2es grepped, and an inverted example composition where the flagship `tui-agent` leaf was defined as an include-patch over the `repl-agent` leaf it superseded.

## Decision

Delete the readline front door and the repl-agent example; keep exactly three front-door archetypes: **interactive TUI** (TTY-only, fails loud on pipes), **one-shot CLI** (`-p`/positional task, pipes and automation), and **servers** (ACP / JSON-RPC).

- `packages/ui/stdio` and `examples/repl-agent` are gone. `packages/examples/stdio-demo` is renamed `@deepseek-ai/dsh-tui-demo` (`packages/examples/tui-demo`) and always mounts `dsh-tui`; the `TerminalMode`/`resolveTerminalMode`/`ui.mode` seam is deleted. The bin refuses non-TTY streams **before booting the Loader** (a compose-time throw inside a Loader tree is logged per-entry, not rethrown, so a piped launch would otherwise settle into an idle UI-less process instead of exiting nonzero).
- `examples/tui-agent/cordis.yml` now owns the coding composition inline (the include-patch inversion is gone); its Code Mode overlay includes its own base. `examples/cordis-agent` moved to the TUI app.
- `examples/echo-agent` moved to the one-shot `dsh-cli-demo` app; `dsh-cli-demo` gained `-p/--prompt` as the flag form of the single task (mutually exclusive with the positional).
- The UI-independent with-key coding e2es (`full-loop`, `coding-task`, `resume`, `compaction`, `todo-write`, `code-mode` and their shared harness) moved verbatim from `examples/repl-agent/tests/` to `examples/tui-agent/tests/` — they assemble the stack programmatically and never touched a UI.
- The SDK wizard's `stdio` run interface became `tui` (`RunInterface = 'acp' | 'tui' | 'embed'`), contributing a `dsh-tui` entry instead of `dsh-stdio`; the generated `index.ts` guards TTY before `startSDK` for the same pre-boot fail-loud reason as the tui-demo bin.

### Testing policy: PTY only for the TUI

Pipes remain the default test medium. PTY-driven subprocess tests are sanctioned **only** where the subject is the TUI itself: `examples/tui-agent/tests/tui-keyless-smoke.e2e.ts` (which gained the Code Mode overlay boot scenario, replacing repl-agent's pipe smoke as the overlay's keyless composition proof) and the minimal PTY boot smoke in `examples/cordis-agent` (whose front door IS the TUI). Everything else moved to pipes over the one-shot bin:

- `examples/echo-agent/tests/echo.e2e.ts` proves the Loader boot + mock-model tool round-trip through `stream-json` records instead of readline transcript lines.
- The CI demo-smoke gate (`scripts/run-gates.ts`, AGENTS.md) runs `demo:echo --output-format stream-json -p "echo ci smoke"` and parses the records structurally.
- The TUI's piped-launch refusal (nonzero exit + pointer at the one-shot CLI) is covered by `apps/cli/tests/built-bin.e2e.ts` (the `dsh` TTY guard under plain Node); the echo-round-trip-under-plain-Node and missing-config fail-loud proofs live in `cli-demo`'s built-bin suite.
- `packages/context/time-context/tests/time-context.e2e.ts` runs one one-shot turn; multi-turn elapsed rendering stays unit-covered in its spec.

## Accepted losses

- **Piped multi-turn in one process** — the readline channel could script several turns over stdin; the one-shot bin runs one task per process. Multi-turn continuity is covered by `RESUME_SESSION_ID`/resume e2es and the TUI's scripted PTY conversation.
- **Non-TTY `ask_user_question`** — the readline provider was the only non-TTY terminal implementation of `ctx.userInteraction`. A headless or ACP automation run whose model calls `ask_user_question` fails that tool call unless its composition supplies a provider; Web owns the shipped non-terminal provider.

## Alternatives considered

- **Keep `dsh-stdio` as a pipe/automation channel without the repl demo** — rejected: its automation role duplicated `dsh-cli-demo` with a weaker contract (unstructured transcript, EOF-exit heuristics vs. one durable turn ending and format-pure output).
- **Rewrite the piped smokes as PTY drivers** — rejected: PTY is the flakier, more complex medium and is reserved for the one surface pipes cannot prove (real TTY takeover/restore).

## Consequences

- One interactive front door (TUI), one automation front door (one-shot CLI), two servers; no mode-selection seam in the terminal app.
- ~1,000 lines of readline unit tests deleted with their behavior; the readline transcript grammar is gone from all gates.
- This supersedes the packaging half of [fold the stdio UI helper](2026-07-04-fold-stdio-ui-helper.md) (the folded package is now deleted) and amends the composition described in [the TUI front-door note](../feature/2026-07-17-dedicated-full-screen-tui-front-door.md) (no `auto` selection; `tui-agent` owns the coding composition).
