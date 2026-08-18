# workflow/ — dynamic-workflow capability family

English | [中文](README.zh.md)

This family runs model-authored orchestration workflows over subagents and exposes general and fixed-policy tools to the model.

| Package | Role | ctx key |
|---|---|---|
| [`workflow/`](workflow/README.md) | Defines workflow execution and lifecycle events | `ctx.workflowEngine` |
| [`workflow-worker-thread/`](workflow-worker-thread/README.md) | Runs workflow scripts in worker threads | registers on `ctx.workflowEngine` |
| [`tool-workflow/`](tool-workflow/README.md) | Exposes general workflow execution to the model | registers on `ctx.tools` |
| [`tool-ralph/`](tool-ralph/README.md) | Exposes the fixed fresh-agent Ralph workflow | registers on `ctx.tools` |

Worker threads isolate workflow execution from the host event loop but are not a security boundary. See the [dynamic-workflow](../../.agents/notes/implemented/feature/2026-07-05-dynamic-workflows.md) and [Ralph tool](../../.agents/notes/implemented/feature/2026-07-19-fresh-agent-ralph-workflow-tool.md) decisions.

The subsystem reference — start requests, `WorkflowMeta`, results, live runs, `workflow/*` events — is [docs/subsystems/workflow.md](../../docs/subsystems/workflow.md); decisions in the [dynamic-workflows](../../.agents/notes/implemented/feature/2026-07-05-dynamic-workflows.md) and [Ralph consumer](../../.agents/notes/implemented/feature/2026-07-19-fresh-agent-ralph-workflow-tool.md) Agent Notes.
