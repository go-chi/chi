# Agent Note: Product-level TUI session resume

Status: implemented
Archived: 2026-08-04

English | [中文](2026-07-21-tui-resume-command.zh.md)

## Problem

The original `/resume` printed shell commands. It did not let a keyboard user inspect titles or outcomes, distinguish corruption from a missing adapter, or safely transfer the terminal. Leaving the TUI and manually launching a command also hid the required ordering: finish current work, flush it, release the UI and app, then restore the exact persisted identity without silently creating a replacement.

## Decision

`/resume` uses the TUI's existing interactive overlay seam as a full-viewport picker rather than a centered dialog. The flat page keeps the search field, workspace scope line, candidates, and shortcut footer in stable screen regions; only the active row uses the accent role. Its search editor starts immediately after the search glyph and emits pi-tui's cursor marker, so terminal IME composition remains anchored in the field. Escape clears a non-empty query before a second Escape closes the picker. It orders candidates by last logged activity and searches log-backed title or id. Each candidate displays current/live/persisted state, last turn outcome, recent provider/model, durable goal phase when present, and the id as secondary text. The current session and sessions already live in this runtime remain visible but disabled. The picker opens on the current workspace and reaches every other one through the scope toggle the [cross-workspace resume](2026-07-28-cross-workspace-resume.md) note owns.

`session-query.readSession()` supplies a detached complete log validated by the same core replay boundary used by resume. The TUI folds title and goal state from that log. A candidate load failure is local to that row; selecting a candidate revalidates the log, workspace, route, current agent's idle status, and the exclusions for the current session and sessions already live in this runtime, so a stale listing cannot bypass preflight. A missing adapter reports an intact session with an unavailable route. This preflight does not lock the target or exclude another process.

After preflight, the TUI flushes the current session, confirms that its agent remains idle, then stops the terminal before calling `TuiRuntime.handoffResume` with the validated id and the target workspace. The shipped `dsh` host disposes the root app and uses `process.execve` with a normalized `--resume` argument, atomically replacing the process rather than starting a child. The resumed app publishes the same `SessionId`; ordinary replay restores transcript, title, todos, and durable goal state. Goal activation is intentionally disarmed, and the TUI asks for human confirmation or `/goal resume`.

The exit line is a launcher-owned context slot rather than a config template, and a host without in-place handoff reports that the session stays resumable instead of naming a command it cannot construct; the [launcher-owned resume identity](../architecture/2026-07-28-launcher-owned-resume-identity.md) note owns that ownership move and supersedes the `resumeCommand` config key this note originally shipped. The TUI still never executes shell text.

## Alternatives considered

**Have the TUI spawn the resume command.** Rejected: the text is display copy, not trusted argv, and the TUI does not own app teardown or process lifetime. The constrained host seam receives only a validated `SessionId`.

**Construct the resumed agent inside the existing TUI.** Rejected: replacing one config-created agent would cross Loader ownership, scoped plugin setup, persistence retirement, and terminal lifecycle in the presentation layer. Root disposal plus process replacement reuses the supported startup path.

**Treat a missing adapter as a missing session.** Rejected: storage validity and current route availability are independent facts. The selector keeps the row and names the unavailable provider/model.

**Persist goal activation across resume.** Rejected: durable intent is not authorization to continue after a human or process boundary. Goal phase survives; automatic continuation does not.

## Consequences

- Concurrent processes can select or resume the same persisted session because preflight does not serialize them.
- `/resume` depends on `session-query` for discovery and complete-log reads, but persistence and host handoff remain optional; without a host, the command fallback stays usable.
- Process replacement intentionally restarts Loader composition. Runtime-only state is rebuilt, while only logged or header-backed session state survives.

## Testing

TUI package tests cover keyboard navigation, title/id search, search-clear/cancel behavior, running-agent refusal, refusal of the current session and sessions already live in this runtime, route absence, corrupt rows, preflight revalidation, the no-host warning, and stop-before-handoff ordering. Session-query tests pin detached full-log validation. Agent-loop resume tests pin exact identity and history; title, todo, and goal replay suites pin restored projections and disarmed goal activation. The package semantic snapshot owns the full-viewport selector and its IME cursor anchor; a deployment shipping the TUI owns its process and PTY handoff acceptance.
