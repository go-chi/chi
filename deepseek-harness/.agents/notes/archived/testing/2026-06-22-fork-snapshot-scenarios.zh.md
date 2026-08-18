# Agent Note: 记录 fork 与混合 spawn+fork 快照场景

Status: implemented
Archived: 2026-07-26

[English](2026-06-22-fork-snapshot-scenarios.md) | 中文

## 问题

[seed 边界 Agent Note（agent 决策记录）](2026-06-22-fork-child-replay-seed-boundary.md)让 fork 子项重放能够正确路由：`dsh-llm-replay` 根据持久化 `seedLength` 边界处及其后的事件派生子项脚本，因此 fork 子项继承的父前缀不会作为子项自身的模型调用重放。但落地时**没有记录式 fork 场景**——slice 只由 `llm-replay` 单元测试（合成子项 fixture（测试前置数据））和持久化往返测试覆盖。完整 transcript（文本记录）快照层——会启动真实 `acp-agent` 并重放端到端嵌套 transcript 的那张网——只有 spawn 子项（`subagent-spawn`、`subagent-multi`）。如果 fork 路由回归没有让单元测试变红，它仍会逃过专为捕获 transcript 回归而构建的这一层。

表达 fork 场景所需的快照基础设施已经就位：两个进程内后端都在 `cordis.yml` / `cordis.snapshot.yml` 中以两个面向模型的工具接入（`subagent` → spawn、`subagent_fork` → fork），harness 会收集每个子会话的日志，回放按 `seedLength` 为键转发各子会话的 fixture。缺少的是一个*已记录的场景*来驱动 fork 子会话走完这条路径。

## 决策

针对真实 API 记录两个场景，均在默认门禁中以无密钥方式回放：

- **`subagent-fork`**：父会话完成一个轮次以建立一个事实，然后通过 `subagent_fork` 委派一个子任务。fork 子会话继承对话（其日志携带非零 `seedLength`），因此可以从父会话的上下文中作答。这是聚焦的回归守卫：子会话 fixture 的 `seedLength` 就是回放切片所依赖的边界，来自真实 fork 的记录而非手工合成。
- **`subagent-mixed`**——父项完成一个轮次，随后在同一 transcript 中通过 `subagent` 委托一次（全新 spawn 子项，`seedLength` 为 0），再通过 `subagent_fork` 委托一次（fork 子项，`seedLength` 非零）。这是 seed 边界与逐会话重放 Agent Note 都点名作为未来新增项的 spawn+fork 混合场景：一份 transcript 覆盖两种传输方式和 slice 的两个分支（`seedLength` 为 0 = 无操作，`seedLength > 0` = 裁剪继承前缀），两个子项按 `createdAt` 排列为先 spawn、后 fork。

### 为什么需要一个已完成的第一轮次

fork 后端使用父项的**已配平完整轮次前缀**为子项提供 seed。父项若在第一个轮次就执行 fork，没有已完成轮次可供继承，因此 seed 为空（≡ 全新 spawn，`seedLength` 为 0）——这不会覆盖 slice。因此，两个场景都使用双提示词输入：第一个提示词完成一个轮次（建立稍后要求子项回忆的 codeword），第二个提示词委托 fork。子项 transcript 中回忆出的 codeword 只是模型行为的附带结果；承载关键约束的产物是子项 fixture 中记录、由重放 slice 消费的 `seedLength`。

## 后果

- fork 路由切片现在由全 transcript 层守卫，而不仅仅是单元测试。移除 `slice(seedLength)`（回放整个子会话日志）会让**两个**新场景变红——fork 子会话收到的是父会话记录的分片而非自己的——证明守卫确实生效（场景落地时已验证红→绿）。
- `subagent-mixed` 是第一个在同一个 transcript 中驱动两种*不同* subagent 后端的快照场景，同时覆盖了跨 spawn 和 fork 子会话的逐会话回放键控。
- 进程外（ACP（Agent Client Protocol））subagent 回放形态不同（每个子会话是独立进程、有自己的回放），仍以 `TODO(acp-subagent-replay)` 跟踪——本文场景仅限进程内。
- 重新录制（`pnpm run test:snapshot:record`）会从真实 API 重新生成全部四个 fork/spawn fixture；两个新场景在无密钥时自动跳过，与所有已录制场景一致。

<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->
