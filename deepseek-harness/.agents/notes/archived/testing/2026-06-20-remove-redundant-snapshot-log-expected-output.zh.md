# Agent Note: 使用 `session.jsonl` 作为唯一的快照会话日志产物

Status: implemented
Archived: 2026-07-26

[English](2026-06-20-remove-redundant-snapshot-log-expected-output.md) | 中文

## 问题

驱动模型的 ACP（Agent Client Protocol）快照场景同时包含 `session.jsonl` 和 `session.expected.jsonl`。对于普通记录场景，`session.jsonl` 是从真实运行采集的重放 fixture（测试前置数据）；重放测试会规范化新持久化的日志，并将其与 `session.expected.jsonl` 比较。在当前 fixture 中，普通记录场景的两份规范化日志完全相同。

手工编写的 override 场景（`error-finish`、`cancel`）目前使用 `replay.override.json` 驱动模型行为，并把 `session.jsonl` 保留为最小 dummy fixture，而 `session.expected.jsonl` 存放预期的持久化日志。override 文件是由 `ReplayEntry` 对象组成的 JSON 数组：`{ "kind": "chunks", "chunks": StreamChunk[] }`、`{ "kind": "throw", "chunks": StreamChunk[], "message": string, "code": string }` 或 `{ "kind": "hang" }`。这种拆分同样没有必要：override sidecar 存在时，`llm-replay` 会替换派生脚本，不需要从 `session.jsonl` 取得模型分片，因此 `session.jsonl` 仍可作为场景的预期会话日志产物。

## 决策

彻底移除 `session.expected.jsonl` 概念。每个场景最多只有一个已提交会话日志产物，即 `session.jsonl`：

- 对于录制场景，`session.jsonl` 仍是原始采集的日志。回放仍从中派生模型分片，快照测试将回放运行归一化后的持久化日志与归一化后的 `session.jsonl` 进行比较。
- 对于手工编写的覆盖场景，`replay.override.json` 驱动模型行为，`session.jsonl` 存放预期产出的会话日志。当覆盖文件存在时，回放适配器不从 fixture 获取模型分片，因此同一个文件既可作为预期日志，又不影响回放行为。
- 对于无模型场景，`session.jsonl` 可保留为引导 `llm-replay` 所需的最小 fixture；除非场景创建了持久化会话，否则无需进行会话日志比较。

Stdout 预期输出保持不变；它们是面向编辑器的投影，与会话 fixture 并不重复。

## 曾考虑的替代方案

**对两侧基于共享的（回放运行）上下文做归一化**：否决。`normalizeSessionLog` 通过精确字符串匹配擦除 cwd，因此 fixture 中录制的 cwd 不会被擦除，每次比较都会失败。两侧各自基于自身 header 派生的上下文做归一化——下方的实现说明描述了具体机制。

## 验证

快照 harness、fixture、孤立项守卫和文档中都不再出现 `session.expected.jsonl`；对于每个模型场景，快照测试都从 `session.jsonl` 派生预期会话日志；手工编写 sidecar 的场景把预期生成日志提交为 `session.jsonl`，并以 `replay.override.json` 覆盖模型行为；孤立 fixture 守卫知道每种场景类型所需的文件。[ACP 快照测试 Agent Note（agent 决策记录）](2026-06-19-acp-snapshot-tests.md)描述了精简后的 fixture 集合。

## 后果

评审者失去了一个能在视觉上区分预期持久化日志与重放 fixture 的产物名。stdout 预期输出仍然保护编辑器 transcript（文本记录），而将重放输出与 `session.jsonl` 比较，无需复制文件即可保留循环/持久化回归检查。

## 实现说明

两侧各自基于自身 header 值做归一化，因为录制与回放具有不同的 id、路径和时间戳。`fixtureContext()` 从 fixture 的 header 派生上下文，使已归一化的 fixture 具有幂等性。会话日志使用普通相等比较而非文件快照更新，因此比较过程不会改写 fixture。
