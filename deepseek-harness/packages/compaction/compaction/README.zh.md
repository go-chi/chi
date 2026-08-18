# @deepseek-ai/dsh-compaction

[English](README.md) | 中文

**`CompactionEngine`**（`ctx.compaction`）定义压缩（compaction）做什么，即判定历史记录是否过大，并将较早范围摘要为单个表层节点，但不规定如何实现。

本包承担压缩能力的 Service Definition 角色，因此各角色均可独立演进，也可独立替换：

| 包 | 职责 |
|---|---|
| `@deepseek-ai/dsh-compaction`（本包） | Service Definition：抽象服务 + `compaction/*` 事件 + `CompactionResult` + 关联检查点源构造函数 + 工具配对边界 helper |
| `@deepseek-ai/dsh-compaction-basic` | Service Provider：`ctx.tokenMeter` 压力 + token 预算保留 + `llm.stream()` 摘要 |
| `@deepseek-ai/dsh-command-compact` | Consumer：面向人类的 `/compact` 命令，基于 `ctx.compaction.compactNow()` 实现 |

与 bash seam 不同，该 Service Definition 依赖 `@deepseek-ai/dsh-session` 和 `@deepseek-ai/dsh-llm`。约定的动词基于 `Session` 定义，其输出使用 `ContentBlock` 词汇，因此无法在不指名这些包的情况下表达。这项对「Service Definition 只依赖 cordis」指引的偏离是有意的，并记录在 [压缩能力 seam Agent Note](../../../.agents/notes/implemented/feature/2026-06-18-compaction-capability-seam.md) 中。

## 服务 API（`ctx.compaction`）

三个操作都是**抽象方法**：触发策略、保留、事件顺序与摘要均属于后端。可复用的请求测量是独立服务 [`ctx.tokenMeter`](../../llm/token-meter/README.md)，而非本 Service Definition 的一部分。

| 成员 | 语义 |
|---|---|
| `compactIfNeeded(agent, trigger, signal)` | 根据 `trigger: 'pressure' \| 'context-overflow'` 判断是否需要自动压缩。压力触发可应用后端的阈值与保留尾部策略；已确认溢出可强制进行有效的平衡缩减。返回 `CompactionResult`，无安全范围时则返回 `null`。后端摘要请求是直接的 `ctx.llm.stream()` 调用（不是 agent loop（智能体循环）步骤），因此每次调用都可在 `llm/stream` 处拦截。 |
| `compactNow(agent, signal)` | 即使未达到自动压力，也显式压缩一段有效、平衡的较早范围。该操作会在让出控制权前同步预留空闲轮次接纳；没有有效范围时不写入任何内容；在摘要前记录独立的 `compaction/* { turn: null }` 尝试；释放预留前等待其持久性检查点。预期操作失败使用 `ManualCompactionError`；取消会原样重新抛出 abort 原因。 |
| `compactRegion(start, end, agent, signal?)` | 强制将表层节点 `[start, end]`（包含两端 seq）从 `agent.session` 摘要为单个替换节点，其源由 `compactCheckpointSource(compactionId)` 创建。如果压缩已在进行、`start`／`end` 不是表层节点，或 `start` 在表层上位于 `end` 之后，则**抛出异常**。该范围是表层位置范围，不是数值 seq 区间：在之前的 replace 将新生成的高 seq 摘要节点放到已遮蔽范围的位置之后，表层顺序不再跟随 seq 顺序。 |

`CompactionResult` 向调用方保留原始摘要与记录操作过程的事件 seq，同时保留已遮蔽范围与 token 计量；其结构由漂移检查保障，定义见 [压缩数据结构参考](../../../docs/subsystems/compaction.md#compactionresult)。

`compactIfNeeded` 和 `compactNow` 必须传入 `signal`；`compactRegion` 的该参数可选。通过 `ctx.llm.stream()` 摘要的后端**必须** 将它转发到调用的 `GenerateOptions.signal`，因此 abort 或 fiber dispose（资源释放）会停止进行中的摘要。自动和显式范围标记对会从当前打开的轮次恢复其数字形式归属。手动标记对不要求存在打开的轮次，并标记 `turn: null`。

`ManualCompactionError.code` 是封闭集合 `busy | changed | summary | commit | persistence`。`changed` 和 `summary` 表示所选会话表层未被替换，但日志仍会记录失败尝试。`commit` 有意不判断是否发生了部分变更；`persistence` 表示内存中的 bracket 已闭合，但显式 flush 失败。

## 工具配对边界

该 Service Definition 导出 `toolPairingBalancedBefore(session, seq)` 与 `toolPairingBalancedAfter(session, seq)`，用于对齐和验证压缩边界。安全边界不会被尚未回答的 assistant 工具调用跨越。每个 helper 都会验证给定事件 seq 位于当前表层，并根据按表层顺序缓存的各切分点配对状态返回结果。

每个会话的私有 cache 以 `session.surface.replaceGeneration` 和已处理表层条目数为 key。generation 未变时，只需将尚未处理的尾部条目纳入累计结果；仅向日志追加、但未新增表层条目时，不会读取事件。replace generation 变化时则会重建当前成员关系与配对状态。事件 seq 缺失以及 `tool/result` 没有对应的先前未闭合调用，均会被视为表层状态损坏并遭拒绝。

## 表层约定

`SurfaceEventType` 是封闭联合：只有 `user/message`、`assistant/message` 和 `tool/result` 可以携带 `surfaceOp`。因此 `compaction/*` 事件**不能**出现在表层上。成功压缩改为：

1. 追加 `compaction/start`（仅日志）：获取锁；
2. 摘要该范围；
3. 追加 `compaction/summary`（仅日志），其中记录摘要、范围、已遮蔽 seq、token 数与提供方／模型调用 envelope；
4. 追加单个 `user/message`，其携带 `source: compactCheckpointSource(compactionId, sourceCommandId?)` 和包含摘要的 `surfaceOp: { op: 'replace', start, end }`：这是**本操作唯一的表层变更**；
5. 追加 `compaction/end`（仅日志）：释放锁。

表层变更（第 4 步）位于锁的起止范围**内**：`compaction/end` 是最后一个事件，因此表层变更落地前绝不会释放锁。如果在 `compaction/start` 与 `compaction/end` 之间崩溃，会留下可检测的遗留锁（一个 `compaction/start` 没有匹配的 `compaction/end`），而不是虚假声称压缩已完成、但表层从未被遮蔽的 `compaction/end`。

这对标记表示获取和释放锁的时间点，并非排他的事件容器。手动摘要等待期间，空闲的 `inject()` 可以在 start 与 end 之间追加不相关的上下文。因此，手动稳定性检查会重新验证所选 span，而不要求整个表层相等；位置替换会让该注入上下文在检查点之后保持可见。自动压缩则要求其活动轮次内的整个表层保持相等。

`deriveMessages()` 随后将摘要渲染为 user 角色消息，再跟上已保留节点。已遮蔽事件仍保留在原始日志中，因此回放具有确定性。

## 阻塞

压缩由所有入口点共享的一个日志记录锁串行化。尾部检查会分别查找最新的未匹配 `compaction/start` 和最新的 `session/end-seed`。位于该边界之后的未匹配 start 是活动锁并报告 `busy`；更早的未匹配 start 是先前进程生命周期留下的陈旧证据，不会阻塞。同一个 end-seed 转换会清除不变量配套组件的回放追踪状态。活动标记对不能跨越 `turn/start` 或 `turn/end`；在接管会话时，如果后续 end-seed 证明打开的标记对已经陈旧，则继承前缀中的修复边界仍可回放。

锁就是持久标记对，而非 `WeakSet`、包装层 mutex 或客户端侧锚点。`compaction/start` 会在摘要让出控制权之前同步追加。之后每次失败都会恰好尝试一次 `compaction/end { error }`；如果追加该闭合事件本身失败，未匹配 start 会继续作为有意保留的 busy 信号，并且不会尝试 flush。已成功闭合的手动尝试即使报告 `changed` 或 `summary` 也会 flush，从而在释放轮次接纳预留前保留该记录。

## 事件

`compaction/*` 事件通过 declaration merging 扩展 `SessionEventMap`（可合并扩展）：它们是会话事件，不是 cordis `Events`，三者均仅存在于日志（不含 `surfaceOp`）。各事件 payload 与语义见生成的 [持久化日志事件目录](../../../docs/persistence-catalog.md)。

## 实现后端

继承 `CompactionEngine`，实现 `compactIfNeeded`、`compactNow` 与 `compactRegion`，再将子类作为插件加载：它会注册为 `ctx.compaction`。每个成功后端都使用 `compactCheckpointSource(compactionId, sourceCommandId?)` 创建替换 user 消息的源；必填的 `compactionId` 将检查点与对应 `compaction/*` 事务关联，而 `isCompactCheckpointSource()` 可在持久化或克隆后识别该标记，无需依赖后端身份。基于模板或模型的实现可以放在同级包中，不需更改调用方或共享 token meter。

## 在 host 程序之外识别检查点（`./checkpoint`）

`compactCheckpointSource()`、`CompactionCheckpointSource` 与 `isCompactCheckpointSource()` 声明在 `@deepseek-ai/dsh-compaction/checkpoint` 子路径上，并由包根重新导出，因此 host 侧消费方仍从根读取它们。构造函数要求传入所属 `CompactionId`，防止后端写入缺少关联关系、必然被包不变量拒绝的标记。该叶子不导入 cordis、也不声明任何模块增强（即 [`dsh-commands/brand`](../../interaction/commands/README.md) 的形状），这正是客户端或 wire 程序能够命名该检查点来源的原因：包的**根**根本无法进入这类程序，因为它会到达 `dsh-session` 的根，而那处 `Context` 合并会让 host 的 `sessions` 服务与客户端自己的冲突（`TS2717`——每侧一个程序，见 [development.md](../../../docs/development.md#typescript-project-layout)）。Web 客户端的 transcript（文本记录）适配器用仅类型导入把它的插件字面量钉在该叶子的源类型上，因此在此处改插件 id 会让那边编译失败。

## 模型体验

### 调用后端时的会话历史

#### 模型看到的内容

成功的实现会用一个 user 角色摘要检查点替换较早表层范围，即一个 `user/message`，它携带 `surfaceOp: { op: 'replace', start, end }`；原始事件仍会记录，但不再出现在派生模型消息中。seam 本身不执行改写。

#### Token 影响

该 Service Definition 不会直接产生 token。后端用一份摘要换取多个原本保留的历史 token，并保持近期尾部不变。

#### KV Cache 影响

成功的后端替换会使从第一个已遮蔽历史 token 起的复用失效；seam 本身不会改变请求。

## 已知限制与暂缓事项

- **面向用户的命令，而非模型工具**：`@deepseek-ai/dsh-command-compact` 通过 `ctx.commands` 暴露无参数 `/compact`；不会注册面向模型的压缩工具。
- **部分单元溢出不在约定内**：平衡摘要压缩无法拆分一个不可分单元。当闭合工具对中可移除的主要部分是承载文本的工具结果时，可选剪枝配套服务仍可修复该工具对；无法压缩大型非工具节点，或不可剪枝剩余部分过大的工具单元。
- **单独接近窗口大小的 envelope 不属于表层压缩工作**：压缩缩减派生历史，绝不缩减系统提示词、工具或会话前缀。
