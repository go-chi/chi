# @deepseek-ai/dsh-tmux-context

English | [中文](README.zh.md)

Opt-in durable context naming the tmux session, window, and pane this agent process runs in, plus the window's pane-tree layout. It is sampled once per turn during model-request preparation and is not part of the shipped Web/headless composition. Decision record: [the tmux-context Agent Note](../../../.agents/notes/implemented/feature/2026-07-27-tmux-location-context.md).

## Config

```yaml
- id: tmux-context
  name: '@deepseek-ai/dsh-tmux-context'
  config:
    refreshIntervalMs: 60000 # optional; omit or set to 0 to inject on every changed turn
```

`refreshIntervalMs` must be a non-negative safe integer. Omission or `0` injects whenever the tmux state changed since the last injection. A positive value additionally suppresses injections that fall within that many milliseconds of the latest one.

## How it reads tmux

The plugin prepends an `agent/pre-step` listener that runs only on the first step of each turn. When due, it runs one read-only command through the `ctx.shell` executor service:

```sh
[ -n "$TMUX_PANE" ] || exit 1
self_tty=$(ps -o tty= -p <pid> | tr -d ' ')
pane_tty=$(tmux display-message -t "$TMUX_PANE" -p '#{pane_tty}') || exit 1
[ "$pane_tty" = "/dev/$self_tty" ] || exit 1
exec tmux display-message -t "$TMUX_PANE" -p '<format>'
```

`$TMUX_PANE` alone is insufficient: a terminal launched from a tmux shell (a VS Code integrated terminal, a desktop launcher) **inherits** `$TMUX` and `$TMUX_PANE` from that ancestor, so the variables are present even though the process does not live in that pane. The command therefore also compares the pane's `#{pane_tty}` against this process's own controlling terminal (`ps -o tty=` for its pid): a genuine pane owns this process's tty, while an inherited environment names some other pane's tty. Running through `ctx.shell` applies the deployment's sandbox and policy; the plugin owns no subprocess code. When `ctx.shell` is absent, the process is not in a real tmux pane (`$TMUX_PANE` unset, or the tty does not match ⇒ nonzero exit), or the reading is malformed, the attempt is a no-op, never an error. The location is optional, so an executor rejection — a policy refusal from `resolve()` or an infrastructure failure from `run()` — is contained and logged as a warning rather than failing the turn.

State is pulled on every eligible turn — a moved, renamed, or re-laid-out pane is picked up without any tmux hook or background process. The plugin re-injects only when the rendered tmux state differs from its last injection, so an unchanged location adds nothing.

## Timing semantics

The plugin prepends an `agent/pre-step` listener. When an injection is due and the downstream decision enters the proposed step, it prepends one sourced `UserMessage` to the returned batch. AgentLoop records that context after `step/start` with source `{ kind: 'plugin', plugin: 'tmux-context' }`. Change suppression and interval scheduling scan the raw durable session events for the latest injection of this source, so the schedule survives compaction and resumed processes without process-local cache state; sessions schedule independently. A downstream pre-step listener that rejects or fails prevents the reading from being recorded.

## Model Experience

### Preparation-time tmux location

#### What the model sees

On each turn whose tmux state changed, one source-tagged context message with the three lines below. `<window-layout>` is tmux's compact pane-tree description; pane and window pixel sizes are intentionally excluded, and the contents of sibling panes are never captured.

##### Changed-turn reading

```markdown
tmux location (turn <turn>):
session <session>, window <index> "<name>", pane <index> <pane-id>
window active=<0|1>, pane active=<0|1>, layout <window-layout>
```

#### Token effect

Each two-line reading accumulates until compaction shadows it. Unchanged locations and interval suppression add nothing.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **First step only** — a pane moved or resized mid-turn is reflected on the next turn, not between steps.
- **Own location only** — the plugin never captures the visible text of sibling panes.
- **Layout, not size** — pane/window pixel dimensions are omitted; only the layout tree and active flags are reported.
- **Tab-delimited fields** — a tmux window name containing the literal two-character sequence `\t` would mis-split the reading and be skipped as malformed; ordinary names are unaffected.
- **tty-based pane detection** — the process is considered "in tmux" only when its controlling terminal matches `$TMUX_PANE`'s `#{pane_tty}`. This deliberately excludes terminals that inherited `$TMUX`/`$TMUX_PANE` from a tmux ancestor (e.g. a VS Code integrated terminal). `ps -o tty=` is POSIX; the check is a no-op wherever it or `#{pane_tty}` is unavailable.
