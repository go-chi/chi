# sandbox/ — process-sandbox capability family

English | [中文](README.zh.md)

This family applies per-session confinement policy to process execution. It covers same-world subprocesses; isolated environments replace complete capability implementations instead of registering here.

| Package | Role | ctx key |
|---|---|---|
| [`sandbox/`](sandbox/README.md) | Defines the process-sandbox service and shared escalation vocabulary | `ctx.sandbox` |
| [`sandbox-local/`](sandbox-local/README.md) | Provides local platform confinement backends | registers on `ctx.sandbox` |
| [`sandbox-policy/`](sandbox-policy/README.md) | Resolves durable per-session sandbox policy | `ctx.sandboxPolicy` |

See the [sandbox decision](../../.agents/notes/implemented/feature/2026-07-06-sandbox.md) for the capability boundary and the [filesystem integration decision](../../.agents/notes/implemented/feature/2026-07-14-cross-family-fs-sandbox.md) for cross-family policy use.

The subsystem reference — modes and enforcement, per-call policy, wrapped-argv dialects, fail-closed errors — is [docs/subsystems/sandbox.md](../../docs/subsystems/sandbox.md); the boundary and the cross-family phase live in the [sandbox](../../.agents/notes/implemented/feature/2026-07-06-sandbox.md) and [cross-family fs sandbox](../../.agents/notes/implemented/feature/2026-07-14-cross-family-fs-sandbox.md) Agent Notes.
