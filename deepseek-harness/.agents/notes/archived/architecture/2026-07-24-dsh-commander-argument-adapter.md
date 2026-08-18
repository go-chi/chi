# Agent Note: Parse `dsh` argv through one Commander adapter

Status: implemented
Archived: 2026-07-26

English | [中文](2026-07-24-dsh-commander-argument-adapter.zh.md)

## Problem

The `dsh` CLI entry (`apps/cli`) parsed argv in three hand-rolled idioms that did not compose and gave no `--help`/`--version`. `bin.ts` dispatched by raw inspection — `argv[0] === 'web'`, then `argv.includes('-p') || argv.includes('--prompt')`, else TUI — which is positional-blind: a prompt flag or a config path in the wrong position could misroute the mode, and `argv.includes('-p')` could not tell a real flag from an incidental token. `headless.ts` and `web.ts` each ran their own `node:util` `parseArgs` with inline host/port validation, and `dsh-app-boot` carried `parseResumeArg`, a ~30-line bespoke scanner reimplementing flag/`=`-form/value/repeat handling for `--resume`. Usage was a single hardcoded `usage: dsh -p "task"` line; there was no version flag and no rendered help.

## Decision

Argv is parsed once, in `apps/cli/src/args.ts`, through a Commander adapter (the same parser the SDK bins — `create-sdk`, `dsh-scripts` — already standardize on). `parseDshArgs(argv, version)` returns a discriminated `DshInvocation` union of the three real modes: `{ mode: 'tui', config?, resume? }`, `{ mode: 'headless', prompt }`, or `{ mode: 'web', host?, port?, dev }`. It does **not** model help/version/errors as data: Commander owns those, printing usage or the diagnostic and exiting at the point of failure. `exitOverride()` turns each into a thrown `CommanderError` carrying the intended code (0 for help/version, 1 for a parse or domain error), which one `try/catch` in `parseDshArgs` turns into `process.exit`.

`bin.ts` calls the adapter once and switches on `mode` (closed union, `satisfies never` default), dynamic-importing only the chosen mode's module; only a valid, non-help invocation reaches the switch, so it has no help/version/error cases. Each mode module consumes already-parsed values: `runTui(config, resume)`, `runHeadless(task)`, `runWeb(host, port, dev, workspaceRoot)` — none re-reads argv. It is **one Commander program**: the default surface (no subcommand) carries option-only flags — `--config <path>`, `-p/--prompt <task>`, `--resume <id>` — and `web` is a real `program.command('web')` subcommand. The default surface takes no positional argument, which is what lets `web` be a real subcommand without a positional collision, so `dsh --help` lists `web` natively (no hand-pasted command text). The default action and the `web` action set the resolved mode, then bail via `command.error(...)` (print + exit 1) on the domain checks Commander cannot express: `--prompt` selects headless and rejects an empty task or a `--config`/`--resume` alongside it rather than silently dropping a TUI input; an empty `--resume=` id fails loud (agent-loop treats `''` as no-resume). Commander parses the default-surface options on either side of the `web` token into `program.opts()`; since `web` shares none of them, the `web` action rejects a leaked `--config`/`-p`/`--resume` (`dsh web -p x`, `dsh --config c.yml web`) rather than silently serving and dropping it. `dsh web`'s `--host`/`--port` are unvalidated pass-through overrides: the adapter assigns no default and does no validation, only `Number`-coercing the port string (the schema wants a number). The `dsh-host-webserver` schemastery `Config` (`host` a `127.0.0.1`/`0.0.0.0` literal union, `port` a natural ≤ 65535) is the single source of both the default (the shipped `apps/cli/cordis.yml` `webserver` row stands when a flag is absent) and validity — `AppCLIEntry` patches an explicit flag straight into that row, so a bad host/port fails loud at the schema on boot, not at parse. `--dev` mounts the client HMR driver and bundle watch, and `--workspace-root <path>` is a plain pass-through to `AppCLIEntry` (the parent directory for name-created workspaces). A repeated `--resume`, or a following flag captured as a `--resume`/`--prompt` value, is Commander's standard behavior (last-wins / next-token) and is left alone; a bad id fails loud downstream when the session cannot load. `--version` reads this app's `package.json`.

`dsh` takes no positional argument. `--config <path>` names an alternate cordis tree to boot instead of the shipped default; it exists only so the demo/test call sites (`demo:cordis`, `demo:code-mode`, the keyless PTY smokes) can point the shipped bin at an example tree. A bare `dsh` boots the shipped tree plus the `~/.dsh/config.yaml` personal overlay; a real user never passes `--config`.

CLI parsing lives entirely in `apps/cli`. `dsh-app-boot` holds the boot/env/config/personal-overlay helpers and no argv scanner.

## Session resume through the boot context

`dsh --resume <id>` is the one way to resume a persisted session, with no environment variable. `runTui` provides the parsed id on the boot context through `boot`'s `prepare(ctx)` hook — `ctx.provide(RESUME_SESSION_ID_KEY, id)` (a `dsh-app-boot` export, value `'resumeSessionId'`) — and the shipped tui-agent/cordis configs read it as a bare identifier: `resumeSessionId: !!js "typeof resumeSessionId === 'string' ? resumeSessionId : undefined"`. The expression is quoted because YAML otherwise parses the `?`/`:` as a mapping; the `typeof` guard tolerates a launcher that never provides the slot. The `/resume` in-place handoff (`process.execve`) rebuilds its re-exec argv from the parsed values as `dsh --resume=<id> [--config <path>]`.

## One terminal front door: `dsh`

`dsh` is the only terminal entry point; the `dsh-tui-demo` package ships the TUI app bundle plugin the shipped config mounts, and no bin of its own. `demo:cordis`, `demo:code-mode`, and both the tui-agent and cordis-agent keyless PTY smokes launch through `apps/cli/src/bin.ts` with `--config <path>`. `dsh`'s TTY guard (refuse piped stdio before booting, pointing at `dsh -p` for automation) is pinned by `apps/cli/tests/built-bin.e2e.ts`, which runs the built `lib/bin.js` under plain Node with piped stdio (`apps/cli/tests` is in the e2e vitest include). `cli-demo`, `acp-demo`, and `jsonrpc-demo` keep their own bins because each is a distinct surface (headless, ACP, JSON-RPC) `dsh` does not provide.

## Package topology

The argument surface stays inside `apps/cli`, the assembly tier, not a `packages/*` library: it is this one app's routing, not a reusable seam. `dsh-app-boot` shrinks to boot glue with no CLI-parsing responsibility. `commander@^15` is added to `apps/cli/package.json`, matching the SDK bins' pin.

## Alternatives considered

**Keep `node:util` `parseArgs` and only unify the dispatch** — rejected: `parseArgs` has no subcommand model, no rendered help, and no version flag, so `web` routing and `--help`/`--version` would stay hand-rolled. The repo already chose Commander for its other CLIs; a second parser idiom for `dsh` alone is the fragmentation this change removes.

**Keep `parseResumeArg` as a shared helper and feed it Commander's residual args** — rejected: the whole point is to retire the bespoke scanner. Commander parses `--resume` (space and `=` forms, missing-value, position-independence) natively; keeping a parallel hand-written path for the one flag would preserve the duplication the change exists to end.

**A bare `dsh <config>` positional for the alternate tree** — rejected: a root positional and a real `web` subcommand cannot coexist in one Commander program (the subcommand claims the first positional). A positional would force `web` into a reserved-first-token dispatch to a separate parser and a hand-maintained `web` line in `--help`. Only the demo/test sites ever need to name an alternate tree, so a `--config` flag serves them while leaving the default surface positional-free — `web` is then a normal subcommand in one program with native `--help`.

**Make the argument surface a `packages/*` seam** — rejected: nothing outside `dsh` consumes it, and capability seams are not split preemptively. The Commander adapter is `apps/cli`'s own concern.

**Keep `RESUME_SESSION_ID` as the resume bridge** — rejected: with `--resume` parsed into a value the bin already holds, threading it through an environment variable the config re-reads is indirection with no benefit, and it left the demo bin a second, env-only resume path. Providing the id on the boot context is the same channel `boot`'s `prepare` hook already uses for `tuiResumeHost`.

**Keep the `dsh-tui-demo` bin** — rejected: it duplicated `dsh --config <path>` exactly, and keeping it forced the demo-only `RESUME_SESSION_ID` fallback to stay alive. Its plugin is what the configs actually mount; only the front-door bin was redundant, and `dsh` is the one terminal entry point.

## Testing

`apps/cli/tests/args.spec.ts` (new; `apps/*/tests` added to the vitest include and `apps/cli/tests` to `tsconfig.host.json`) covers the adapter at the level that matters: mode routing by shape (including `web --dev` and the host/port pass-through), the exit-code behavior for the adapter's fail-loud checks (empty resume/prompt, `--prompt` mixed with a config/`--resume`, unknown option, stray positional), and `--help`/`--version`, captured through a `process.exit` spy. Host/port validity is the webserver schema's job, exercised on boot by the web smoke, not the adapter spec. Both PTY smoke groups in `examples/tui-agent/tests/tui-keyless-smoke.e2e.ts` now drive the real `apps/cli/src/bin.ts`: the `tui-agent` group boots an example tree through `--config`, and the `dsh CLI` group covers default boot, personal overlay, invalid config, the `--resume` config intake, the `process.execve` in-place resume handoff, and the source-path prompt. `examples/cordis-agent/tests/keyless-smoke.e2e.ts` likewise launches through `dsh`. `packages/ui/app-boot/tests/app-boot.spec.ts` drops its `parseResumeArg`/`replaceResumeArg` blocks; the TUI unit and snapshot fixtures use the `dsh --resume {session}` resume command.

## Consequences

`dsh` has rendered `--help`/`--version` and consistent fail-loud parse errors, and mode routing does not depend on flag position. Argv parsing lives in one place with one parser idiom shared with the SDK bins, at the cost of a `commander` dependency on `apps/cli` and Commander's parse semantics (its error strings, its `exitOverride` contract) sitting on the CLI's front door. `dsh-app-boot` owns no CLI-parsing surface; a consumer needing `--resume`-style parsing composes Commander. Session resume rides the boot context rather than an environment variable, and `dsh` is the single terminal front door — the `dsh-tui-demo` package is a plugin bundle a config mounts.
