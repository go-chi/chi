# Agent Note: `dsh migrate`/`dsh upgrade` seed the first turn with a skill

Status: implemented
Archived: 2026-08-03

English | [中文](2026-07-28-dsh-guided-skill-session-commands.zh.md)

## Problem

Two recurring flows begin with the user manually invoking one skill and answering its questions: migrating from another coding agent, and upgrading this checkout. Both require the user to know the skill exists and to type `/skill:dsh-migrate` or `/skill:dsh-upgrade` as the session's first turn. A dedicated entry command that drops the user straight into that guided session removes the discovery step.

## Decision

`dsh migrate` and `dsh upgrade` boot the ordinary TUI as a fresh session whose first turn auto-invokes a bundled skill (`dsh-migrate`, `dsh-upgrade`), exactly as if the user typed `/skill:<name>` and pressed Enter.

The seed reuses the existing TUI skill path, not a new one. `createTuiChat` already has `invokeSkill(name, instructions)` — the code a typed `/skill:<name>` runs, including the "Unknown skill" notice. The launcher passes the skill name to the TUI through a new boot-context slot `INITIAL_SKILL_KEY` (`tuiInitialSkill`), mirroring `CONFIGURED_AGENT_IDENTITIES_KEY`/`TUI_GOODBYE_MESSAGE_KEY`: `ctx.provide` is the only channel from launcher argv into a Loader-mounted plugin. The TUI's `apply()` reads the slot and folds it into `config.initialSkill`; after `ui.start()` succeeds, `createTuiChat` fires `invokeSkill(config.initialSkill, '')` once when set.

**Freshness is gated in the launcher, not the TUI.** `runSkillSession` always mints a fresh session and provides the slot only when `resumeSessionId === undefined`, so a later `dsh --resume <id>` of that session is an ordinary TUI session with no re-injection. The TUI stays generic: it invokes whatever skill it is handed, once, at startup.

**`migrate`/`upgrade` take no default-surface options** (`upgrade` additionally carries the [experimental gate](2026-07-31-experimental-subcommand-gate.md)'s `--experimental`). They carry no `--resume`, `--config`, or `-p`; a guided fresh-session entry has nothing to resume or reconfigure. Any leaked default-surface option fails loud, matching the `web`/`meta` rejection pattern in the Commander adapter. The two modes share one `SkillSessionInvocation` discriminant (`mode: 'migrate' | 'upgrade'`); `bin.ts` maps the mode to `dsh-${mode}`.

The `dsh-migrate` skill is bundled under `skills/` (shipped through `DSH_BUNDLED_SKILL_DIR`, like `dsh-upgrade`). It asks which source agent (opencode/pi/Claude Code/Codex) if unstated, then maps each capability — workspace instructions, personal overlay, skills, hooks, MCP, API/env — to its DSH equivalent, grounded in the actual repo surfaces (the `hooks-claude`/`hooks-codex` bridges, `~/.dsh/{config.yaml,.env,AGENTS.md,skills/}`, `AGENTS.md`/`CLAUDE.md`, `mcporter`), and states plainly when a capability has no equivalent.

## Testing

`apps/cli/tests/args.spec.ts` gains routing for `migrate`/`upgrade` (bare discriminant) and exit-1 for every leaked option on either side of each subcommand.

`packages/ui/tui/tests/tui.spec.ts` gains two fake-terminal cases in the existing skill describe block: `config.initialSkill` set delivers the rendered skill body as the first turn with no user input, and an unknown initial skill reports a notice without sending. `runSkillSession` itself is composition inside the module's `v8 ignore` block, like `runTui`/`runMeta`.

No keyless PTY snapshot: per the maintainer's scope call for this change, unit coverage plus interactive verification suffices, and the seed rides the already-snapshotted `/skill:` render path. Both commands were verified interactively in tmux from a scratch cwd: `dsh migrate` loaded `dsh-migrate` and asked which source agent; `dsh upgrade` loaded `dsh-upgrade`, which pulled in `dsh-customize` and began checkout discovery.

## Alternatives considered

**Prefill the input and let the user press Enter.** Rejected: needs a new editor-prefill seam and still requires a keystroke. Auto-submit reuses `invokeSkill` and delivers the intended one-command entry.

**Seed a natural-language instruction ("use the dsh-migrate skill…") instead of `/skill:<name>`.** Rejected here: the literal skill-invocation path renders the skill body into the first turn deterministically, identical to the manual command, rather than depending on the model choosing to load the skill.

**Support `--resume` on `migrate`/`upgrade`.** Rejected: these are one-shot guided entries. A resumed session is an ordinary TUI session reachable through the default surface's `dsh --resume <id>`; re-injecting the skill on resume would duplicate the first turn.

**Read `INITIAL_SKILL_KEY` outside the TUI (as `CONFIGURED_AGENT_IDENTITIES_KEY` is read by `agent-loop`) rather than in the TUI's `apply()`.** Not needed: `initialSkill` is a TUI `Config` field consumed in `createTuiChat`, so folding the slot into config at the TUI entry keeps it beside the other launcher-owned runtime reads (`tuiResumeHost`, `tuiGoodbyeMessage`) and touches no other plugin.

## Consequences

Migrating or upgrading is one command from anywhere, with the guiding skill already invoked. The launcher→TUI initial-skill slot is reusable by any future guided-session command; the TUI's contract is "invoke this named skill once at startup," and freshness/resume policy stays with the launcher that owns session identity. The [TUI skill slash command](2026-07-21-tui-skill-slash-command.md) remains the mechanism; this note adds a launcher-driven auto-invocation of it and does not supersede it.
