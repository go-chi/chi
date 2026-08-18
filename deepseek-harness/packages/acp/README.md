# acp/ — Agent Client Protocol automation

English | [中文](README.zh.md)

The ACP group exposes harness agents to programmatic clients over the Agent Client Protocol. It is an interoperability transport, not a presentation or human-interaction layer; the matching out-of-process subagent *client* lives in [`subagent/subagent-acp`](../subagent/subagent-acp/README.md) because it implements the subagent provider interface.

| Package | Role |
|---|---|
| [`acp/`](acp/README.md) | Automation-only ACP server. |

The server contract is documented in [`acp/README.md`](acp/README.md).
