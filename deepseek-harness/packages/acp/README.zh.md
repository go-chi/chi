# acp/：Agent Client Protocol 自动化

[English](README.md) | 中文

ACP（Agent Client Protocol）组通过该协议将 harness 中的 agent（智能体）公开给程序化客户端。它是互操作传输层，不是展示或人机交互层；配对的进程外 subagent *客户端*在 [`subagent/subagent-acp`](../subagent/subagent-acp/README.md)，因为它实现的是 subagent 提供方接口。

| 包 | 职责 |
|---|---|
| [`acp/`](acp/README.md) | 仅面向自动化的 ACP 服务器。 |

服务器约定见 [`acp/README.md`](acp/README.md)。
