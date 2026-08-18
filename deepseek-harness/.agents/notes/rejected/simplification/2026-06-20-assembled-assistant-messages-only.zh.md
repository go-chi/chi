# Agent Note: 仅持久化组装后的 assistant 消息，不存储流式分片

Status: rejected — 高保真分片回放、失败流的部分输出与快照回放目前依赖持久化的 `assistant/chunk` 事件。只有具备无信息损失的回放或产物替代方案后，才能删除分片。

[English](2026-06-20-assembled-assistant-messages-only.md) | 中文

## 问题

当前的规范会话日志会持久化模型流式输出的每一个 `assistant/chunk`。[会话持久化 Agent Note](../../implemented/architecture/2026-06-14-session-persistence.md)选择这一方案是为了 token 级回放保真度和连续的 `seq`，但其代价日益增长：JSONL fixture（测试前置数据）被大量微小的增量记录占据，快照场景通过对分片事件分组来回放模型，ACP（Agent Client Protocol）加载时从分片重建先前的 assistant 输出，而任何未来的日志读取方都必须区分持久的消息历史与 token 级追踪。

对于成功组装出完整内容的步骤，agent loop（智能体循环）已经追加了一条 `assistant/message`。这正是 `deriveMessages()` 用来构造下一次模型请求的事件。换言之，正常的可恢复会话状态无需分片即已具备；分片是实时渲染和确定性测试的产物，不是必需的会话历史。失败或中止的流则不同：部分 assistant 输出可能仅以分片形式存在，而空的 max-token 步骤可能根本不产生 `assistant/message`。

## 提案

停止在规范会话日志中存储 `assistant/chunk`。持久日志保留 `assistant/message`、`tool/call`、`tool/result`、`usage`（如保留）以及轮次边界。实时 UI 仍可通过一个明确设计为瞬态的流事件接收 token 增量。快照回放应将其模型脚本移入显式的 fixture 伴随文件，或从记录的适配器产物中派生，而非将规范的用户会话当作 token 磁带。需要失败流部分输出的场景必须在回放 fixture 中记录该输出。

ACP `session/load` 可以将先前的 assistant 消息作为完整内容块回放，而非模拟原始的 token 流。加载后的 transcript（文本记录）无需重现每一个历史 delta；它必须展示相同的已完成 assistant 内容，并基于有效的提供方历史继续运行。

## 验收标准

- `SessionEventMap` 移除 `assistant/chunk`，或在需要过渡性实时事件时将其标记为非持久化。
- [会话持久化文档](../../../../packages/session/session-persistence/README.md)不再要求逐字存储每个流式分片。
- `llm-replay` 和 ACP 快照使用显式的回放 fixture 格式或伴随文件来存储模型分片。
- `session/load` 从 `assistant/message` 渲染已完成的 assistant 消息。
- 存储的日志大幅缩小，且删除分片后仍保持 `seq` 连续，不留下序号缺口。
- 会话格式版本与已记录的 fixture 一并刷新；按预发布格式策略拒绝非当前版本的存储日志。

## 放弃了什么

规范的用户会话不再能重建旧轮次的精确 token 流。它也会丢失失败或中止流的部分 assistant 输出，除非另有事件或 fixture 记录。对于当前的恢复、加载和快照约定而言，这是过大的信息损失。需要精确确定性流的测试应当直接拥有该 fixture，前提是生产会话日志为用户可见的恢复保留了足够的保真度。

## 相关

本 Agent Note 取代 [会话持久化](../../implemented/architecture/2026-06-14-session-persistence.md) 中关于分片持久化的决策，并影响 [ACP 快照测试](../../implemented/testing/2026-06-19-acp-snapshot-tests.md)——其当前的回放插件从 `assistant/chunk` 事件派生脚本。

<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->
