# Agent Note: 嵌套 agent 的逐会话快照回放

Status: implemented

[English](2026-06-22-subagent-snapshot-replay.md) | 中文

## 问题

快照层（`pnpm run test:snapshot`）会启动真实 `acp-agent` 子进程，通过 [`dsh-llm-replay`](../../../../packages/test-support/llm-replay) 回放已记录会话，并将规范化后的自动化协议输出 + 重新持久化的会话日志与已提交预期输出进行 diff。大多数场景通过这条真实进程边界测试组装后的后端行为。

该层最初为每个进程只有一个会话而构建，这一假设硬编码在两处：

- **`dsh-llm-replay` 没有做任何键控。** 它用一个全局游标，将第 N 次 `llm/stream` 调用对应到单一录制序列的第 N 条。当父 agent（智能体）和一个进程内 subagent 在同一个上下文上同时流式输出时，调用交错，单一游标会把子 agent 的脚本发给父 agent（反之亦然）。
- **harness 只收集一份日志。** `findSessionLog` 遍历 sessions 根目录，返回找到的第一个 `.jsonl`。subagent 作为第二个 `Session` 运行并拥有自己的日志，因此子 agent 的 transcript（文本记录）被静默丢弃。

这就是 [subagent seam Agent Note](../feature/2026-06-21-subagent-capability-seam.md) 中通过 `TODO(subagent-snapshots)` 推迟的工作：进程内后端落地时已有单元 + e2e 覆盖，但在这套基础设施落地前，完整 transcript 快照层无法表达嵌套 agent 形状。

## 决策

回放按**调用方会话**键控，harness 收集**所有**会话日志。

### 1. 调用方会话 id 附着在模型请求上

`GenerateOptions` 新增可选字段 `sessionId`，在请求组装时从 `agent.session.id` 赋值。适配器忽略它；`llm/stream` 监听器用它按发起会话路由。其类型为 `Branded<'SessionId'>`（来自 `dsh-brand`）而非 `dsh-session` 的 `SessionId`，因为后者所在包导入了 `dsh-llm` 的 `Message`，反向导入会形成循环。两个类型等价，因此会话 id 赋值无需类型转换。将 brand 移到一个专用 ids 包属于独立工作，因为它会影响所有 id 导入。

### 2. 回放按首次调用顺序将活跃会话绑定到录制脚本

嵌套场景录制多份日志：父会话（`session.jsonl`）加每个 subagent 子会话各一份（`session.1.jsonl`……）。`dsh-llm-replay` 全部加载，为每个录制会话派生一份脚本，并按 header 中的 `createdAt` 排序（父会话先于子会话创建）。

活跃会话 id 每次运行都是全新随机值，永远不等于录制时的 id，因此活跃会话无法通过 id 相等绑定到脚本。取而代之的是**首次调用顺序**绑定：第一个发起任何模型调用的活跃会话认领第一份有序脚本（即父会话：`createdAt` 最早，且必然最先流式输出，因为它必须先运行一个轮次才能委派），下一个新活跃会话认领下一份脚本，依此类推。此后每个会话独立推进自己的游标。

这种方式按谁在调用键控，而非按全局调用顺序。因此即使 subagent 将来并发或在后台运行（全局游标会导致交错），它仍然正确。不携带 `sessionId` 的调用（直接在单元测试中调用 `stream()`）被视为一个匿名会话、绑定到主脚本，因此单会话路径与旧行为逐字节一致。活跃会话数多于录制脚本数时会明确报错（出现了未录制的 subagent），绝不会静默错误路由。

子 fixture（测试前置数据）按 `createdAt` 排序，在兄弟会话严格顺序执行时与调用顺序一致。id 决胜规则仅用于让极端情况下的时间戳冲突获得确定顺序。并发或后台子会话必须引入显式的首次调用序号，而非依赖时间戳。

## 曾考虑的替代方案

曾考虑但否决的方案是：**将父子日志按调用顺序合并**为一份全局脚本（仅在进程内 subagent 执行严格嵌套——父 agent 阻塞等待子 agent——时才正确）。对当前的同步实现而言更简单，但将「父阻塞于子」这一不变式固化了进去；未来若引入后台/并发 subagent 就会失效。逐会话键控则不会。

### 3. harness 收集所有日志，主会话优先

`harvestSessionLogs` 递归收集 sessions 根目录下所有固定命名为 `session.jsonl` 的 transcript（JSONL 后端为每个父会话和子会话分别提供独立的项目/会话目录），解析各自的 header，并按主会话优先排序：顶层会话（无 `parentSession`）在前，各子会话按 `createdAt` 升序排列。`RunResult.sessionLogs` 包含多份日志；spec 在录制时将每份日志写回对应 fixture（`session.jsonl` + `session.<n>.jsonl`），在回放时将每份收集到的日志与其 fixture 做 diff。归一化器已支持多个会话 id 并会折叠任何游离 UUID，因此无需修改归一化器。

### 4. 场景

新增两个嵌套场景，均对真实 API 录制：

- **`subagent-spawn-in-process`**：父 agent 通过 `subagent` 工具将一个子任务委派给一个新 spawn 的子 agent（2 个会话）。
- **`subagent-multi`**：父 agent 委派两个子任务，各自交给自己的 spawn 子 agent（3 个会话），以三份独立的逐会话脚本和同一父 agent 下两个子会话的 `createdAt` 排序来压测逐会话键控。

两者均在默认门禁中以 keyless 方式回放。

## 后果

- `TODO(subagent-snapshots)` 延期项已解决：嵌套 agent 的 transcript 现在是快照层的一等形态。
- `GenerateOptions.sessionId` 是一个小而诚实的 core API 新增，在回放之外同样有用（遥测、请求路由）。
- `subagent` 工具绑定到单一提供方，因此 `subagent-multi` 中的两个子 agent 都是 spawn（全新创建）。键控按会话路由而非按后端路由，因此对 fork 同样正确。但脚本*派生*逻辑此前不正确：fork 子会话的日志以种子化的父前缀（父会话的 `assistant/chunk` 事件）开头，如果从完整日志派生脚本，就会把父 agent 的响应当作子 agent 的来回放。这一正确性缺口通过持久化种子边界来弥合——见[持久化 seed 边界以确保 fork 子会话回放正确路由](2026-06-22-fork-child-replay-seed-boundary.md)——录制的 fork 与混合 spawn+fork 场景现在通过一份 transcript 同时验证两种传输方式（见[记录 fork 与混合 spawn+fork 快照场景](../../archived/testing/2026-06-22-fork-snapshot-scenarios.md)）。
- 进程外（ACP（Agent Client Protocol））subagent 是完全不同的回放形态（每个子 agent 是自己的进程、有自己的回放），作为 `TODO(acp-subagent-replay)` 记录在 `subagent-acp` 中。
