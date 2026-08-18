# hooks/ — hook bridges + shared protocol

English | [中文](README.zh.md)

The hooks subsystem lets users extend the agent at lifecycle points the way Claude Code and Codex do — by pointing a bridge plugin at an existing `hooks.json` (or settings) so those external shell hooks run faithfully. The canonical extension surface itself is the harness's typed interception points ([the interception extension-points Agent Note](../../.agents/notes/implemented/feature/2026-06-30-interception-extension-points.md)); a "native hook" is just an ordinary Cordis plugin on those extension points. These packages are the **bridges** that translate the external shell-hook protocol onto that same surface, plus the shared wire-protocol library they build on.

| Package | Role | Shape |
|---|---|---|
| [`hook-protocol/`](hook-protocol/README.md) | Shared shell-hook protocol library | library |
| [`hooks-claude-code/`](hooks-claude-code/README.md) | Claude Code hook bridge | plugin |
| [`hooks-codex/`](hooks-codex/README.md) | Codex hook bridge | plugin |

The shared library owns common protocol behavior; each bridge owns its dialect-specific event mapping. The child READMEs document those contracts.
