# Agent Note: 持久化 seed 边界以确保 fork 子会话回放正确路由

Status: implemented

[English](2026-06-22-fork-child-replay-seed-boundary.md) | 中文

## 问题

[逐会话快照回放 Agent Note](2026-06-22-subagent-snapshot-replay.md)使快照层能够表达嵌套 agent（智能体）形状：一个父项加上每个进程内 subagent 的一份记录日志，每份日志都按调用会话作为键，以独立脚本回放。它曾指出（§ 范围，最后一个项目符号），fork 快照「只是未来很容易添加的一项，并非键控缺口」。这一判断对 fork 子会话而言是错误的——问题不在键控，而在*脚本派生*。

subagent 脚本由 [`deriveReplayScript`](../../../../packages/test-support/llm-replay) 从已录制的会话日志推导：它按 `(turn, step)` 对日志中的 `assistant/chunk` 事件分组，每次 `stream()` 调用对应一条回放条目。对 **spawn** 子会话而言这是正确的，因为其日志只包含自身的模型调用。

**fork** 子会话不同。fork 后端用*父日志的一段平衡的已完成轮次前缀*（[`dsh-subagent-in-process-driver`](../../../../packages/subagent/subagent-in-process-driver)）来播种子会话，而该 seed 会成为子会话持久化的 `log`（`Session` 构造函数将 seed 复制进 `this.log`）。因此 fork 子会话的 `.jsonl` 以**父会话**的事件开头——包括父会话的 `assistant/chunk` 事件——之后才是子会话自身的轮次。

从 fork 子会话的完整日志推导脚本，会把**父会话**的已录制响应当作**子会话**的模型调用来回放：实际运行的 fork 子会话第一次调用 `stream()` 时，会收到父会话的第一段分片序列而非自身的。当时已录制的场景全部是 spawn，所以这从未触发——但 fork 快照会静默地错误路由，恰好属于快照层存在的意义所要捕获的那类 bug。

## 决策

记录会话**继承**前缀的结束位置，将其持久化，并让回放 harness 仅从子会话**自身**的事件推导脚本。

### 1. 会话头部的 `seedLength`

`SessionHeader` 新增可选字段 `seedLength: number`——表示有多少前导事件是通过 seed 继承而来、而非本会话产生的。fork 后端在创建子会话时设置它（= 播种前缀的长度）；全新的 spawn 子会话不设置（等同于 0）。它通过 `CreateSessionOptions.meta`（及 `CreateAgentOptions.meta`）传递，在 `SessionStore.prepare` 中设置。

`seedLength` 是**显式**的，绝不从 `seed.length` 推断。恢复/加载时用会话的完整已存储日志作为 seed，此时 `seed.length` 是全长而非原始边界——恢复路径改为从加载的 header 中取回持久化的 `seedLength`。（做法与 `createdAt` 相同：恢复时显式保留，而非重新默认为当前时间。）

### 2. 两个持久化后端均完整往返

- **JSONL**：header 行上的 `seedLength` 字段（`toHeaderLine`/`fromHeaderLine`）。
- **SQLite**：`sessions` 表上的 `seed_length` 列。

包含 `seed_length`、`source_event_seqs` 和 `surface_op` 的 SQLite 布局为 schema version 4。更早的 version 3 布局存在歧义，因此在预发布策略下，所有非当前 `user_version` 均直接拒绝，不做迁移。

### 3. 回放从边界之后推导子会话脚本

`dsh-llm-replay` 的 `parseSessionHeader` 现在也读取 `seedLength`（缺失则为 0），`loadSessionScripts` 从 `parseSessionLog(text).slice(seedLength)` 推导子会话条目——即边界及之后的事件，也就是子会话自身的模型调用。对 spawn 子会话而言 `seedLength` 为 0，此操作是空操作，spawn 场景逐字节不变。

这弥补了路由正确性的缺口，两个已录制的 fork 场景对其进行端到端验证——见[记录 fork 与混合 spawn+fork 快照场景](../../archived/testing/2026-06-22-fork-snapshot-scenarios.md)。

## 曾考虑的替代方案

- **在 `llm-replay` 中启发式推导边界**（播种前缀是连续的父事件，止于子会话第一条 `user/message` 之前的最后一个 `turn/end`）。否决：在测试 harness 中用脆弱的启发式重新推导一个生产者已经知道的事实。在源头（fork 后端）持久化边界，是「在包边界处显式优于隐式」这条规则跨越持久化边界的应用——子会话 fixture（测试前置数据）的读取者永远不需要重建继承在哪里结束。
- **固定格式版本而不递增**（事件日志使用的 `SESSION_FORMAT_VERSION = 0`「不稳定」姿态）。对 SQLite *表*布局否决：`SCHEMA_VERSION` 是单调递增并拒绝旧版的旋钮（数量不多、可枚举且值得区分的一组修订），与事件词汇的 `version` 不同。新增列正是它所版本化的那种破坏性表变更，因此需要递增。

## 后果

- core 与两个后端新增一个持久化 header 字段；子系统目录（`persistence.md`）在同一变更中更新（其 `SessionHeader` / `CreateSessionOptions` 的 `type-equiv` 块）。
- 既有的 schema v2 SQLite 数据库在打开时被拒绝（预发布阶段无用户数据）。
- spawn 回放不变（`seedLength` 为 0）。fork 回放现在将子会话路由到自身的脚本；由 `llm-replay` 测试中的一个回归用例覆盖（一个子会话 fixture，其播种前缀包含父会话的分片——推导出的子会话脚本必须排除它，不做 slice 时该用例会失败）以及一个持久化往返测试（两个后端，通过共享的 coordinator 约定）。
