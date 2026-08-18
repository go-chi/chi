# sdk/ — drive Harness runtimes from another process

English | [中文](README.zh.md)

This group contains the protocol stack for driving a Harness runtime from another process. Callers supply the runtime executable and its `cordis.yml`; this group does not create, configure, build, or launch developer projects. The [TypeScript SDK decision](../../.agents/notes/implemented/feature/2026-07-27-typescript-sdk-and-sdk-subagent-backend.md) owns the client contract, and the [toolchain removal](../../.agents/notes/implemented/simplification/2026-08-11-remove-sdk-project-toolchain.md) owns the product boundary.

| Package | Role |
|---|---|
| [`protocol/`](protocol/README.md) | Defines the SDK runtime wire protocol |
| [`client/`](client/README.md) | Drives a Harness runtime through the TypeScript client API |
| [`server/`](server/README.md) | Serves out-of-process SDK clients over stdio JSON-RPC |
