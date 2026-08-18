# Agent Note: parseCmdline runs the program's own commander action

Status: implemented

English | [中文](2026-08-11-cmdline-program-action.zh.md)

## Problem

`dsh-cmdline`'s ([app-owned command line](../architecture/2026-08-06-app-owned-command-line.md)) `parseCmdline` carried a bespoke callback: `CmdlinePlan<T> = (program, ctx) => T`, invoked after a successful parse inside the helper's catch so a plan's `program.error(...)` shared the help/parse-error exit path, with a type-unsound `(() => ({}) as T)` default only tests used and a `ctx` argument no plan read. The whole seam duplicated a slot commander already defines: a command's action handler runs inside `parse`, and `program.error(...)` thrown from it obeys `exitOverride` exactly like a grammar rejection.

## Decision

`parseCmdline(ctx, program): void` only adapts commander control flow to the launcher: it parses the immutable `cmdlineArgs` snapshot and turns help, version, parse errors, and action rejections into a `ctx.appExit` request. App code — validation commander's grammar cannot express and the `ctx.provide` of the app-owned service — lives in the program's own synchronous `.action()`, which commander runs on a successful parse and never runs on help or rejection. The `CmdlinePlan` export, its `ctx` parameter, the default plan, and the `T | undefined` return are deleted; both bundle providers publish from their action. Because the `Command` type cannot express the action precondition, `parseCmdline` reads the handler structurally (as `isCommanderError` reads commander's control-flow errors) and refuses at load a program in which no command declares an action — without the guard, a provider that forgot its action (or a stale caller still passing the deleted third argument) parses successfully, publishes nothing, and surfaces only as dependent rows pending on the absent service at settlement. The helper configures `exitOverride` and output on the whole command tree, not the root alone: commander copies those settings into a subcommand only at registration, so a root-only override would let a pre-registered subcommand's rejection call `process.exit` past `ctx.appExit`. An action must reject before it publishes; statements before its `program.error(...)` have already run.

Verified on commander 15 before shipping: an action runs inside `parse` and its `program.error(...)` throws a `CommanderError` through `exitOverride`; help and version short-circuit before the action; excess-argument handling is identical with and without an action.

## Alternatives considered

- **Keeping a bespoke `resolve`/plan callback**: it existed only so app rejection could share the helper's catch, which commander's action slot already provides; a second callback seam for the same moment in the parse lifecycle is duplication.
- **Returning the parsed `Command` for the caller to read**: a post-parse `program.error(...)` in the caller escapes the helper's catch as an uncaught `CommanderError`, turning a usage rejection into a plugin load failure; every app with validation would rebuild the try/catch the helper owns.
- **Moving all validation into commander option/argument parsers**: `InvalidArgumentError` covers per-value checks, but the headless bundle rejects a joined variadic ("task must be non-blank") with its own usage message, which per-argument parsers cannot express.
- **Accepting an action-less program and relying on the settlement diagnostic**: the assembled launcher does fail loud (`pending (waiting for service: …)`), but that error names the consumers, not the misconfigured provider, and an embedding host without the settlement assertion would hang silently; the load-time guard reports the culprit program directly.
- **Replacing the `CmdlineArgs` accessor with a bare frozen `readonly string[]` service**: the maintainer keeps the accessor object as the service's named interface.

## Consequences

- `parseCmdline` loses its generic, callback parameter, and `undefined` sentinel; callers lose the `if (values !== undefined)` publish guard.
- An app's command is self-contained — flags, help text, validation, and the publishing effect travel together on the `Command`.
- Actions must be synchronous: the helper calls `parse`, not `parseAsync`, so a returned promise would escape the catch unobserved.
