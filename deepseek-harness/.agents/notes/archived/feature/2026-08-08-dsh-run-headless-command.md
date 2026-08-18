# Agent Note: `dsh run` owns one-shot headless execution

Status: implemented
Archived: 2026-08-10

English | [中文](2026-08-08-dsh-run-headless-command.zh.md)

> **Superseded command grammar.** [Apps now own their command lines](../architecture/2026-08-06-app-owned-command-line.md): the headless startup row parses the task from `dsh --profile headless <task...>`, and the launcher no longer has a `run` invocation or patches task text into rows. This note remains the rejected launcher-owned design context; the direct execution and completion contract it selected remains current in [headless is a direct core entry point](../architecture/2026-08-09-headless-direct-core-entry-point.md).

## Problem

Generic profile boot and one-shot task execution have different lifecycle contracts. A root grammar that accepts optional task text makes one argv shape mean either a long-lived process or a terminating task according to a plugin row discovered only after composition. It also exposes a profile implementation detail as the primary user command and gives custom profiles no explicit one-shot entry.

The `run` verb must have one top-level meaning. Sharing it with application-file execution or inferring its meaning from positional shape creates the same ambiguity.

## Decision

One-shot execution owns this grammar:

```text
dsh run [--profile <name>] [--patch <path>...] <task...>
```

`--profile` defaults to `headless` and supports custom one-shot compositions. `--patch` is repeatable and occupies the normal overlay layer. Commander joins the variadic task arguments with spaces and rejects a missing or blank task before boot.

`RunInvocation` is a distinct `DshInvocation` member. The generic profile invocation carries no task state and accepts no positional arguments. Both dispatch paths use `runProfile`: profile boot omits `task`, while `run` supplies it. A one-shot profile without `headless-runner` fails through the composed-row check, and profile boot containing that row without a task points to `dsh run --profile <name> "<task>"`.

The [profile plugin bundle decision](../architecture/2026-08-05-profile-plugin-bundles.md) owns composition. [Headless is a direct core entry point](../architecture/2026-08-09-headless-direct-core-entry-point.md) owns the execution contract: one fresh persisted Session, final assistant text on stdout, completed/non-completed exit mapping, empty stderr on success, no listening port, and bounded signal shutdown after Agent quiescence and Session flush.

The `run` verb belongs only to one-shot task execution. Application-file launch requires a distinct command name.

## Alternatives considered

| Alternative | Contract mismatch |
|---|---|
| Put task text on root profile boot | Lifecycle meaning depends on a plugin row discovered after parsing. |
| Accept root aliases such as `dsh -p` | The pre-release grammar acquires compatibility branches with no current command ownership. |
| Require `--profile headless` | The shipped one-shot surface loses its shortest canonical spelling. |
| Use `dsh run` for application files | One top-level verb has two meanings and the primary task command becomes indirect. |
| Add a shallow `apps/cli/src/run.ts` forwarder | Command ownership splits without hiding any complexity. |

## Consequences

Help, documentation, parser tests, built-bin acceptance, PTY shutdown coverage, and the assembled keyless snapshot use `dsh run`. Custom one-shot profiles use `--profile`; long-lived profile boot and config dumps keep the root profile grammar. Application-file execution is a separate command concern.
