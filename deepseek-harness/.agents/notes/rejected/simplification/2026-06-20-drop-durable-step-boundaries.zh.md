# Agent Note: 移除持久化的步骤边界事件

Status: rejected — `step/end` 是模型步骤已完成的持久信号；保留对称的 `step/start` / `step/end` 对，比从相邻的步骤级事件推断完成状态更便于理解崩溃修复、不变式与 transcript（文本记录）检查。

[English](2026-06-20-drop-durable-step-boundaries.md) | 中文

## 问题

会话日志存储了 `step/start` 和 `step/end` 事件，尽管每个步骤级事件本身已经携带 `{ turn, step }`：assistant 分片、assistant 消息、工具调用、工具结果、用量和错误。`deriveMessages()` 忽略步骤边界，ACP（Agent Client Protocol）在 UI 层面也忽略它们，主要消费方是不变式检查、测试、快照预期输出和崩溃恢复。

被否决的论点是：边界事件使日志更像仪式而非信息。实际上，`step/end` 是具体信息：读者无需从下一个事件推导状态，就能判断一次模型请求是已完成、已崩溃还是正在修复。同样，单独一条 `step/start` 对于「模型请求已发起但在产生任何分片之前就失败了」的场景也有价值。

## 提案

将轮次作为唯一的持久化边界。`step/start` 和 `step/end` 将从 `SessionEventMap` 中移除；在需要分组的事件上保留数值型 `step` 字段。agent loop（智能体循环）递增步骤计数器并以该编号记录步骤级事件，但不再追加开始与结束边界事件。消费方通过共享 `(turn, step)` 的连续事件推断步骤分组。

不变式插件应当强制步骤级事件在一个已打开的轮次内具有有效的正整数步骤编号，而非要求独立的边界记录包围它们。崩溃恢复不应合成 `step/end`；如果一个被中断的轮次被保留，修复路径仍然可以关闭该轮次而无需捏造步骤边界记录。

## 验收标准

- `SessionEventMap` 不再包含 `step/start` 或 `step/end`。
- agent loop 中不再有 `closeStep()` 终结路径。
- ACP 快照和持久化约定 fixture（测试前置数据）不再期望步骤边界行。
- `deriveMessages()` 和回放从步骤级事件推导出相同的消息历史。
- [事件分类体系文档](../../../../docs/architecture.md)将轮次描述为持久化边界，将步骤描述为步骤级记录上的一个字段。
- 会话格式版本和已记录的 fixture 被刷新；按预发布格式策略，非当前版本的已存储日志被拒绝。

## 放弃了什么

日志不再将「一次模型请求已发起但进程死亡前未产生任何事件」记录为持久化事实，也不再有显式的「此步骤已完成」标记。在会话日志仍是持久化回放与审计表面的当下，这一损失不可接受。

<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->
