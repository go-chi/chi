# Agent Note: experimental subcommands gate behind `--experimental` or `DSH_EXPERIMENTAL=1`

Status: implemented
Archived: 2026-08-03

English | [中文](2026-07-31-experimental-subcommand-gate.zh.md)

## Problem

The `meta` and `upgrade` entry points carried their experimental status in their names: `dsh experimental-meta` and `dsh experimental-upgrade`. The prefix made every invocation verbose, and renaming a command at stabilization would break every reference to it — muscle memory, scripts, and docs alike. The status belongs in an opt-in gate, not in the name.

## Decision

`dsh experimental-meta` is `dsh meta` and `dsh experimental-upgrade` is `dsh upgrade`. Each runs only when the invocation passes its `--experimental` flag or the environment carries `DSH_EXPERIMENTAL=1`; otherwise the command fails loud on stderr with exit 1, naming both opt-ins. Per the pre-release stance, the old names are gone with no aliases, and `args.spec.ts` pins their rejection.

The gate has two halves with one owner each. The per-invocation half is a Commander `--experimental` option on each experimental subcommand, checked inside its action after the leaked-parent-option rejection. The environment half is a boolean `parseDshArgs` parameter: `bin.ts` reads `process.env.DSH_EXPERIMENTAL === '1'` at the process boundary (after `loadEnv`, so a project `.env` can set it) and passes the result down, so the parser's environment dependency is explicit in its signature and the tests need no env mutation. `1` is the only enabling value — the variable is an explicit opt-in, not a truthiness check.

Stabilizing a command later means deleting its `--experimental` option and `requireExperimental` call; the name does not move.

## Testing

`args.spec.ts` pins both admit paths, bare-name rejection, old-name rejection, and leaked-option rejection under the env opt-in. `built-bin.e2e.ts` proves the assembled entry end to end: the gate diagnostic on stderr with exit 1, and that `--experimental`, `DSH_EXPERIMENTAL=1`, but not `DSH_EXPERIMENTAL=0`, reach the TUI's piped-stdio refusal — the next gate past this one. Both gated commands were also verified interactively in tmux: `dsh meta --experimental` and `DSH_EXPERIMENTAL=1 dsh meta` boot the TUI over the checkout, and `DSH_EXPERIMENTAL=1 dsh upgrade` seeds the `dsh-upgrade` skill.

## Alternatives considered

**Keep the `experimental-` name prefix.** Rejected by the user's direction: the prefix taxes every invocation, and stabilization would be a breaking rename instead of deleting a gate.

**A parent-level `--experimental` flag (`dsh --experimental meta`).** Rejected: the default surface is deliberately option-only with `enablePositionalOptions`, so parent options that leak across the subcommand boundary are treated as mistyped invocations. A parent flag consumed only by two subcommands would be exactly the leaked-option shape the adapter rejects everywhere else.

**Read `process.env` inside `parseDshArgs`.** Rejected: the repo validates at the process boundary and keeps typed seams pure; tests would have to mutate and restore `process.env` around each case.

**Accept any non-empty `DSH_EXPERIMENTAL`.** Rejected: the telemetry switch prefers off-by-mistake for a privacy control, but an experimental gate is an acknowledgement — `DSH_EXPERIMENTAL=0` must not enable the commands it names.

## Consequences

Daily invocations shorten to `dsh meta --experimental` and `dsh upgrade --experimental`, and a developer who sets `DSH_EXPERIMENTAL=1` in their environment gets the bare `dsh meta`/`dsh upgrade`. `dsh --help` marks both commands `(experimental)`. The gate costs one extra flag or env var until a command stabilizes, at which point the gate is deleted and the name is already final.
