# core/ — product API spine

English | [中文](README.zh.md)

The session log, system-prompt assembly, tool registry, agent vocabulary, deployment-default model selection, and concrete loop that form the harness's default control spine. These are **product** packages — the stable surface plugins and consumers build against.

| Package | Role | ctx key |
|---|---|---|
| [`scope/`](scope/README.md) | Scoped-context registration primitive | library — no ctx key |
| [`session/`](session/README.md) | Event-sourced session log and in-memory store | `ctx.sessions` |
| [`system-prompt/`](system-prompt/README.md) | Prompt and tool-schema assembly registry | `ctx.systemPrompt` |
| [`tools/`](tools/README.md) | Scoped tool registry and execution pipeline | `ctx.tools` |
| [`agent/`](agent/README.md) | Agent interface, registry, and event vocabulary | `ctx.agents` |
| [`agent-default-model/`](agent-default-model/README.md) | Default model selection shared by Agent entry points | `ctx.agentDefaultModel` |
| [`agent-loop/`](agent-loop/README.md) | Default concrete agent driver | `ctx.agentLoop` |

`scope` supplies the shared scoping primitive. `agent` owns the public contract, while `agent-loop` is its default implementation; extension plugins depend on the seam so the driver remains swappable. `agent-default-model` owns the deployment selection an Agent entry point uses only when a session has no selection of its own.

Runnable compositions belong to [`examples/agent-spine-demo`](../examples/agent-spine-demo/README.md); this group owns only the swappable spine pieces.

The subsystem reference — the package-by-package loop map, the `Agent` handle and its delivery/interception contracts — is [docs/subsystems/core.md](../../docs/subsystems/core.md); the default runnable composition is [`examples/agent-spine-demo`](../examples/agent-spine-demo/README.md).
