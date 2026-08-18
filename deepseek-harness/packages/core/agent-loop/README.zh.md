# dsh-agent-loop

[English](README.md) | 中文

agent（智能体）的唯一具体实现插件和循环驱动器。其包内部实现满足 `Agent` 接口，并驱动会话、轮次和步骤的生命周期。

这是 harness 中唯一包含具体循环逻辑的包。其他所有内容要么是抽象服务，要么是针对扩展点的插件：新行为应放入插件，而不是这里。

## 服务：`AgentLoop`（ctx 键：`agentLoop`）

### 公开 API

创建与恢复属于同一个受回滚保护的事务：构造私有会话、具体 agent 和带作用域的上下文；等待可选 setup；进入两个注册表；依次宣告 `session/created` 和 `agent/created`；发出 `agent/session-start`；此后才启动驱动器。Setup 作为受信任的同进程组合代码，接收完整的带作用域 `Context`，并且不得驱动尚未发布的 agent。普通的类型化身份与选项输入按只读约定借用；seed 事件和会话元数据会跨越持久会话边界，因此系统会对其进行验证并创建快照。可选的 `AbortSignal` 只取消加载／setup／发布，并在返回的 handle 可见前分离。

调用方 fiber 与 AgentLoop 提供方共同拥有 agent。`AgentFactory.createAgent(ownerCtx, options)` 与 `resume(ownerCtx, options)` 显式接收调用方所有权，而工厂为 `sessions`/`llm`/`tools`/`systemPrompt` 保留自身的依赖上下文；这样，调用方可以只注入 `agents`，而不会缩减新 agent 的服务接口。调用方卸载、handle dispose（资源释放）或提供方卸载都会汇合到同一个记忆化的完全停稳边界。提供方关闭会同时等待资源 teardown，以及已经观测到停用的公开 create/resume 包装层，因此依赖消失后，任何 continuation 都无法继续发布。

每个 agent 与其会话共享一个由调用方选择的 `SessionId`，并假设它在全局唯一；意外的 UUID 冲突不属于受支持模型。两个使用同一 id 的并发操作都可以进行准备，但最终的 `enter()` 调用会裁决发布，所有失败方都会回滚各自的私有资源。每次 detach 都绑定到确切进入的对象，因此陈旧 disposer 无法移除之后出现的同 id 替代项。在同步创建通知期间请求的 detach 会等待该次分发退栈，从而保留 created/disposed 配对。Teardown 按以下顺序执行：停止并排空 → 撤销作用域 → detach agent → detach 会话。私有作用域清理完成后，该 id 即可复用。不具否决能力的普通 `agent/*` 通知通过 `agentEvents(ctx, agent)` 发出；逐步骤组装通过 `assembleContextFor(agent)` 完成。

- `ctx.agentLoop.create(id: SessionId, options?: AgentOptions, meta?: { cwd?: string }): Agent`：在确切共享的 agent／会话 id 下同步创建，不运行 setup，并随调用方 fiber 一同 dispose。声明式配置把 `agents[].id` 视为稳定 label，通常会先生成 `${label}-session-<uuid>`，再调用此边界。应用也可以提供稳定且确切的 `sessionId`：首次使用时创建；重新挂载且持久化内容已存在时，则恢复已经实体化的历史。`resumeSessionId` 要求并加载现有的持久化 id，且与 `sessionId` 互斥。这样，默认情况下每次重启都会创建新会话，从而避免冲突，也无需保留第二个实时路由身份。

`AgentLoop` 还实现 `AgentFactory` 约定，并通过 `ctx.agents.setFactory(this)` 注册自身，因此插件会通过 `ctx.agents` 创建／恢复 agent：

- `ctx.agents.create({ sessionId, meta?, seed?, agentOptions?, setup?, signal? }): Promise<AgentHandle>`：使用调用方提供的共享 id 以编程方式创建。它会等待尚未发布的 setup 事务，然后才返回；`meta` 携带 cwd／谱系／seed 边界元数据，`seed` 则在会话边界验证并快照持久值后，重建 fork 子级的前缀。`signal` 只在此 Promise 结算前生效。返回的 [`AgentHandle`](../agent/README.md) 拥有确切的 teardown 能力。
- `ctx.agents.resume({ resumeSessionId, agentOptions?, setup?, signal? }): Promise<AgentHandle>`：通过 `ctx.sessionPersistence` 加载持久化会话（参见[会话持久化](../../../.agents/notes/implemented/architecture/2026-06-14-session-persistence.md)），使用同一 id 注册 agent，重建历史，然后针对全新且尚未发布的 agent 作用域等待 setup，再执行受回滚保护的发布。轮次编号和派生历史从已加载日志继续。此操作要求存在会话持久化后端（不会硬注入，因此非持久化 demo 仍能工作；缺少持久化时，`resume` 会以明确错误拒绝）。`signal` 仅用于创建。返回 `AgentHandle`。

配置驱动的 `ctx.agentLoop.create()` 路径让循环 fiber 拥有其 agent（该路径会丢弃 handle）。对于以编程方式创建的 agent，handle 持有者是唯一面向消费方的 teardown 能力；AgentLoop 提供方卸载是一条独立的结构性 teardown 边，而不是向应用代码公开的另一个 handle。

### 注入的服务

`agents`、`sessions`、`llm`、`tools`、`systemPrompt`：全部 5 个接口服务。

### 不变量配套入口

可选的 `@deepseek-ai/dsh-agent-loop/invariant` 配套入口会向 `ctx.invariants` 注册请求重建。循环会把每个确切的冻结请求记录在 `dsh-llm` 拥有的进程本地身份集合中；随后，配套入口要求存在实时会话，并根据日志独立重建消息边界和折叠后的请求 header。即使调用方冻结直接的一次性调用，或为其附加会话 id，这类调用仍不属于该约定。

### 配置（Schemastery）

```ts
interface Config {
  maxParallelToolCalls?: number // default 10; 1 is serial
  agents: Array<{
    id: string                 // required
    provider?: string
    model?: string
    maxTokens?: number         // positive per-request output-token cap
    resumeSessionId?: string   // load this persisted session instead of creating one
    cwd?: string               // optional workspace cwd for the fresh session
  }>
}
```

通过配置创建的 agent 会自动启动。模型调用同时需要 `provider` 和 `model`；`agent/request` 可以在分发前补齐缺失的这一对值。可选的正数 `maxTokens` 会为每次对话请求提供初始输出上限，并记录在请求 header 中。`maxParallelToolCalls` 限制每个 agent 针对并行安全调用使用的滚动池，默认值为 `10`；它同时也是 `agent-loop` Settings 段的全部内容，因此叠加在该条目之上的用户层无需重启即可限制下一组工具调用，而非正整数的值会在写入时被拒绝，而不是到那一组时才失败。`agents` 刻意不在该段中——它在服务启动时被消费一次，所以存储的改动只会看起来生效。`cwd` 仅应用于全新会话，而 `resumeSessionId` 保留持久化元数据。通过配置创建的 agent 使用部署 persona；编程式 setup 可以按 agent 遮蔽它。该插件为每个 agent 提供 `provider`、`model` 和 `cwd` 提示词变量；harness 身份与部署 persona 属于 `dsh-system-prompt`。

### 包内部具体驱动器

具体 `ReactLoopAgent`、其 inbox 与运行控制均为包内部实现。包根只导出插件／服务／配置约定，包导出映射不提供 `./src/*` 逃逸路径；生命周期拥有方通过 `ctx.agents` 创建 agent，而不是点名、构造或启动驱动器内部组件。一个准备完成的会话只能由一个具体驱动器认领；所有可观测行为都通过会话事件和 `agent/*` 事件分类体系发生。

统一的 `send()` 原语按（`target` × `wakeup`）路由内容与来源；`followup`/`steer`/`inject` 是它的固定预设别名。`followup()` 追加到 `next-turn` FIFO 并唤醒驱动器，`steer()` 追加到 `next-step` inbox 并唤醒驱动器，`inject()` 则追加到同一个 `next-step` inbox，但不唤醒驱动器。在轮次边界，驱动器会先打开持久轮次，再原子领取待处理的 next-step 输入和一条排队提示词；在步骤之间则只领取 next-step 输入。领取操作通过仅执行删除的 splice 移除整批消息，并为每条消息各发出一次 `agent/inbox/claimed { message, turn }`。随后 `agent/pre-step` 返回拒绝结果，或返回将进入拟议步骤的完整消息。拒绝后，已领取批次保持已删除，并关闭不含步骤的轮次；领取后插入的输入仍等待后续处理，而空闲注入会一直等待，直到 follow-up 或 steering 唤醒驱动器。

每次 inbox 变更都会在修改实时投影之前，先发布一条规范化的 `agent/inbox/spliced` 事件。因此，插入、编辑、移除、领取与取消都通过同一组标准 splice 坐标回放。普通删除携带 `outcome: 'canceled'` 并发出 `agent/inbox/discarded { message }`；领取使用不带 outcome 的纯删除，随后由循环发出 `agent/inbox/claimed`。每次插入都会发出 `agent/inbox/inserted { message }`。`MessageId` 在两个待处理列表之间保持唯一，持久事件的同步观察方可以从 splice 前投影重建被移除的值。

### 循环生命周期（`agent.ts`）

驱动器在其整个生命周期内拥有一个 agent，并在 `ctx.agents.withInitiator(agent, ...)` 内运行。包私有的编排入口点会恢复确切的 Agent，一次性派生 `agent.session`，并让操作局部的辅助函数捕获它，而不是通过浅层接口继续传递具体驱动器或每次操作的 `Session`。如果显式 `Session` 正是辅助函数的实际接口，该辅助函数会保留它；创建、持久化加载、未发布 setup、服务、worker、进程、持久化和 wire 协议则继续保留各自的显式身份。[agent 服务](../agent/README.md#initiating-agent-scope)规定传播、teardown 和分离工作规则。

每次提供方调用成功结束时，都会恰好追加一个 `assistant/message` 完成锚点，包括无内容调用和以 `max-tokens` 结束的调用。该锚点原样记录组装后的内容，在 `sourceEventSeqs` 中列出确切的分片 seq（流没有分片时为 `[]`），并在用量可用时包含用量；空内容不会进入派生消息历史。

在 `agent/request` 返回提供方／模型调用配置后，循环会调用 `ctx.llm.prepareCall()`，在活跃轮次信号的控制下校验由适配器负责的字段，并填入配置的推理（reasoning）强度和输出 token 默认值。准备完成的调用会在这次异步解析、`request/header` 日志记录和最终分派期间保留同一项确切的适配器注册，因此 HMR（热模块替换）不会把某个适配器的能力解析结果与另一适配器的请求混用。请求 header 会记录生效配置以及哪些字段来自适配器。下一次 waterfall（瀑布式事件）前，循环会从提议中移除这些带标记字段，使当前精确路由重新填入自身默认值；未带标记的显式设置会跨步骤和路由变化保留。没有已注册适配器的路由会保留原定配置，使 `llm/stream` 监听器可以接管并短路该请求；最终分派仍会以 `NO_ADAPTER` 拒绝未得到处理的路由。新循环实例在恢复时会遵循同一套适配器默认值标记规则。

插件失败会结束当前轮次，而不是结束循环。最终适配器选择、分发与迭代失败会以终止错误或中止结束的形式由 `ctx.llm` 传来，并进入 `agent/request-error`；middleware、结果处理、工具及其他扩展失败仍会抛出并直接关闭轮次。恢复逻辑会接收请求坐标、不可变的提供方事实、准备完成的适配器注册所捕获的不可变重试策略以及轮次信号；middleware 接管未准备路由时，该策略缺失。处理失败的监听器返回 `{ kind: 'retry' }`；未被处理的失败是终态。AgentLoop 为当前准入操作或轮次拥有一个取消信号。有效的 `cancel(cause)` 在未设置 `keepInbox` 时清除待处理工作，并以协作方式中止该信号；空闲取消是空操作。abort 触发后、活动收敛到空闲前到达的唤醒输入会被锁存（`wakeRequested`），并在 driver 自身的收敛边界重放，无需再发一条唤醒 send 即可执行；`disposed` 取消从不锁存，而 agent 已处于空闲时发送的唤醒总是打开自己的 turn 边界（即使消息已被清除，状态也会显示瞬态 `idle → running → idle` 对）。持久 `turn/end` 为 `user` 和 `parent` 记录 `aborted`，dispose 则记录 `disposed`；未分发的模型工具调用会收到合成的 `tool/call` 与 `ABORTED_BEFORE_DISPATCH` 结果对。取消原因只影响报告方式，不影响如何处理在取消后完成终结的结果上下文。dispose 会等待忽略信号的工作完成，然后才从注册表移除。[显式取消决策](../../../.agents/notes/implemented/architecture/2026-07-16-explicit-turn-cancellation.md)与[取消收敛窗口唤醒锁存](../../../.agents/notes/implemented/bug-fix/2026-08-07-cancel-convergence-wake-latch.md)规定生命周期与竞态约定。

在步骤内，独占调用形成屏障；并行安全调用使用有界滚动池，并在启动前重新分类。只有分发和调用主体的执行会发生重叠。策略、持久结果和结果上下文仍保持模型顺序。中止会阻止启动新的调用，等待已启动调用的结果处理完毕，并保留其完成终结后的结果上下文，不区分取消原因。内部调度器故障会停止新的分发，等待已启动的分发，然后在不虚构工具结果的情况下到达轮次错误边界。

### 插件负责的内容

超出「调用模型、运行工具、重复」的所有内容，都属于监听事件分类体系的插件：
- 钩子与策略：相关的 `agent/*` 检查点，加上受守卫保护的 `tools/pre-execute` → `tools/execute` → `tools/post-execute` → 定义拥有的 `finalizeContent` → `tools/result` 流水线；确切事件签名与 mode 位于 [core.md](../../../docs/subsystems/core.md#cordis-surface) 与 [tools.md](../../../docs/subsystems/tools.md#cordis-surface) 的生成区块
- 压缩（compaction）：在 `agent/pre-step` 上观测压力；在 `agent/request-error` 上进行规范的溢出修复
- 模型请求恢复：`dsh-llm-retry` 在 `agent/request-error` 上记录并等待针对确切提供方配置的 normal 或无界退避，发出不进入表层的 `llm/retry` 状态，然后返回重试动作
- 沙箱、权限、计划模式：使用 `tools/pre-execute` 提供可扩展的拒绝／询问，使用 `tools.guard()` 提供单调拥有方策略，使用 `tools/post-execute` 处理结果决定，并使用 `tools/result` 进行最终观测
- subagent：在循环外部实现为 `ctx.subagents` 提供方；进程内提供方使用 `ctx.agents.create()` 创建 agent，并通过其拥有的 `AgentHandle` 执行 teardown，而通用的 [`ctx.jobs`](../../jobs/jobs/) 与 [`dsh-tool-subagent`](../../subagent/tool-subagent/) 负责后台收集。
- 持久化：`session/event` 发生后立即安排延后写入；`session/flush` 是显式观测屏障
- UI：`session/event`（assistant token 流、边界、工具活动）+ `agent/*` 控制事件（`agent/status`、`agent/created`/`agent/disposed`）

## 模型体验

### 完整对话请求

#### 模型看到的内容

每个步骤中，循环会发送针对该 agent 呈现的系统提示词、可见工具 schema 和会话派生消息。它提供 `provider`、`model` 与 `cwd` 变量值，但不添加固定文案。

#### Token 影响

每个步骤都会再次计入系统文本与 schema。逐 agent 作用域决定贡献，而权威组装 waterfall 可以改变最终请求，并使其监听器负责保持协议连贯。

#### KV Cache 影响

只有在同一提供方和模型路由下，且系统文本、schema 与此前历史都保持逐字节一致时，请求 token 序列才保持仅追加。携带 token 的组装改写或组合变更可能从第一个改变的请求 token 起使复用失效。

### 保留的消息历史

#### 模型看到的内容

已接纳的 user 消息、assistant 消息、工具调用与结果、注入上下文和 steering（中途引导）都会记录，并在后续步骤中发送。原始流分片、生命周期边界和其他仅写入日志的事件会被排除。

#### Token 影响

输入会随每条表层消息增长，直到压缩替换遮蔽较旧节点；包含多个步骤的工具轮次会在每个步骤重新发送累积的历史。

#### KV Cache 影响

普通历史增长仅追加，并保留可复用条目。表层替换或压缩会从第一个被遮蔽的历史 token 起使复用失效。

### 取消后未分发的调用

#### 模型看到的内容

如果后续请求回放一个中止的步骤，取消所阻止分发的每个工具调用都有错误码 `ABORTED_BEFORE_DISPATCH`，结果文本为 `Error: tool call aborted before dispatch`。

#### Token 影响

每个跳过的调用都会在历史中保留一个固定错误结果，直到压缩将其遮蔽。

#### KV Cache 影响

仅追加；每个合成结果都位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

## 已知限制与暂缓事项

- **分类是一元的**：安全性取决于比较同级调用或资源的调用必须保持独占（参见[设计原理](../../../.agents/notes/implemented/feature/2026-07-10-parallel-tool-call-execution.md)）。
- **配置 label 默认对应新会话**：省略 `sessionId` 时，每次启动都会创建新的 `${id}-session-<uuid>`；如需确切的恢复或创建行为，必须显式提供稳定的 `sessionId`，而 `resumeSessionId` 要求已有持久化历史。
- **配置 agent 没有逐 agent persona 字段或 setup 钩子**：它们使用部署 persona；只有编程式 `ctx.agents.create()` / `resume()` 工厂选项支持带作用域的 persona／工具组合。
- **没有内置轮次预算**：工具调用或 steering 会让当前轮次继续；限制失控轮次的策略必须从既有生命周期扩展点（如 `agent/turn-stopping`）执行取消。
