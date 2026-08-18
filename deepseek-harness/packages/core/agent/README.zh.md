# dsh-agent

[English](README.md) | 中文

Agent 接口、注册表、进程本地发起方作用域，以及 `agent/*` 事件词汇。每个插件（UI、钩子、编排器）都面向此处定义的 `Agent` handle 编程；它不依赖循环，因此循环可以替换。

可选配套包 `@deepseek-ai/dsh-agent/invariant` 会向 `ctx.invariants` 注册此包的 agent（智能体）状态转换检查。根 agent 服务不会隐式加载诊断。

## 服务：`AgentRegistry`（ctx 键：`agents`）

跟踪实时 agent，并在异步驱动器工作中携带发起调用的 Agent，而无需导入具体循环包。

### 公开 API

带作用域的注册接口：`Agent.ctx` 是 agent 的作用域上下文（`dsh-scope`，键 = 该 agent）。通过它注册工具／段／变量／监听器，只对该 agent 生效，并在 dispose（资源释放）时全部撤销。`agentEvents(ctx, agent)` 是普通 agent 主体操作的融合分发器（一次完成载体 + 注入主体）；其通知 mode 会调用每个监听器，并同时收容同步抛出和返回 Promise 的拒绝。注册表生命周期对复用一个稳定路由载体。`assembleContextFor(agent)` 构建按 agent 的组装上下文（同时包含 `agent` + `scope`）。`installAgentLlmTarget(agentCtx, target)` 在提示词组装期间快照可变的提供方／模型／推理（reasoning）强度选择，将路由应用到提示词变量，并将完整目标应用到一个步骤的请求路由；如果没有选定推理强度，则会清除继承的推理强度，使该目标使用适配器／提供方默认值。`CreateAgentOptions.setup(agentCtx)` 和 `ResumeAgentOptions.setup(agentCtx)` 在新建或恢复的 agent 尚未发布时，组合其带作用域的世界。Setup 是受信任、仅用于组合的同进程代码：只有创建完成后才能驱动 agent。

`AgentOptions` 提供初始的提供方／模型路由，以及可选的正数 `maxTokens` 输出上限。具体循环会解析确切模型的适配器默认值，把生效上限记录到请求 header，并应用到每次对话模型请求；显式 Agent 选项优先，省略时由适配器或提供方路由默认值控制。

- `ctx.agents.register(agent: Agent): () => void`：记录一个 **已经构造完成** 的 agent。随调用 fiber dispose。
- 高级有序生命周期：`enter(agent, owner): () => void` 强制 `agent.id === agent.session.id`，执行权威 ID 冲突检查，并在不通知的情况下插入；`owner` 显式记录实时创建方 agent 关系（根 agent 为 `undefined`），与持久会话谱系无关。`announce(agent)` 恰好发出一次 `agent/created`。创建监听器同步请求的 detach 会延后到该次分发结束；每次 detach 都会检查捕获的条目对象，因此陈旧能力无法删除后续使用同一 ID 的替代项。异步工厂使用这一拆分；普通插件使用 `register()`。
- `ctx.agents.get(id: SessionId): Agent | undefined`
- `ctx.agents.isOwnedBy(id: SessionId, owner: Agent): boolean`：该确切实时条目是否通过父 agent 的作用域上下文创建；运行时所有权与持久会话谱系无关。
- `ctx.agents.list(): Agent[]`
- `ctx.agents.roots(): Agent[]`：在没有所属 agent 上下文的情况下创建的实时 agent；带谱系的恢复会话仍可能是运行时根。

#### 发起方 Agent 作用域

`AgentLoop` 在发起方边界内运行每个具体驱动器的完整生命周期。并发驱动器彼此隔离：子驱动器的 continuation 携带子 agent，而 `withInitiator()` 返回后，父 continuation 立即重新取得父 agent；drain 跟踪持续到子驱动器的 Promise 结算。创建、持久化加载和未发布 setup 位于子边界之外，因此由父 agent 发起的 setup 会继承父 agent，而 `agentCtx.agent` 显式标识子 agent。

- `ctx.agents.currentInitiator(): Agent | undefined`：读取继承的发起方，不要求其存在。
- `ctx.agents.requireInitiator(): Agent`：读取发起方，缺席时抛出 `no initiating agent is active`。
- `ctx.agents.withInitiator(agent, operation)`：使用一个确切 Agent 运行，并保留操作的确切同步值或 Promise。
- `ctx.agents.withoutInitiator(operation)`：对无关的进程本地工作隐藏继承的发起方。

该作用域携带 `Agent` 本身，并且只在进程内有效。环境中的身份既不是存活证明，也不是授权；在服务、worker、进程、持久化和 wire 边界，显式 Agent 字段仍是权威来源。Teardown 会拒绝新边界，允许注入的依赖方和返回 Promise 的边界 drain，然后禁用底层 `AsyncLocalStorage`；未返回的工作仍归将其分离的子系统所有。如果某个边界继承的异步链开始卸载一个拥有它的 Cordis fiber，该嵌套边界链会从 drain 中释放，使卸载不会等待自身；其 continuation 会在 teardown 后观察到已 dispose 的服务。详细边界与 teardown 约定由[发起方作用域决策](../../../.agents/notes/implemented/architecture/2026-07-15-agent-initiator-scope.md)拥有。

#### 工厂 API（创建）

Agent *创建* 由实现 `AgentFactory` 的插件（`dsh-agent-loop`）提供，并通过 `setFactory` 注册。这样，创建功能留在 `dsh-agent` 接口上，消费方（UI、ACP（Agent Client Protocol）桥接层）可以面向 `ctx.agents` 编程，而不依赖具体循环包。注册表会把已经 traced 的 Service 规范化为具体目标，并通过调用方上下文重新 trace 每次调用；这既避免嵌套 Cordis shadow，也会把显式、绑定调用方的 `ownerCtx` 传给普通工厂。

- `ctx.agents.setFactory(factory: AgentFactory): () => void`：注册创建工厂（循环在构造时调用）。第二个工厂会导致抛出；dispose 时清空槽位。
- `ctx.agents.create(options: CreateAgentOptions): Promise<AgentHandle>`：创建会话和 agent，在不发布的情况下等待可选 setup，然后通过最终的 `SessionStore.enter()` 与 `AgentRegistry.enter()` 检查发布。不支持并发创建同一 ID：多个操作可以进行准备，但只有一个能进入；每个失败方都会回滚其私有作用域／会话／驱动器。可选且只用于创建的 `signal` 会取消未发布的 setup，并在返回 handle 前分离；之后的取消使用 `handle.dispose()` 或 `agent.cancel()`。发布包含在回滚范围内，回滚期间每条已交付创建边都会成对处理。未注册工厂时拒绝。
- `ctx.agents.resume(options: ResumeAgentOptions): Promise<AgentHandle>`：加载持久化会话（[会话持久化](../../../.agents/notes/implemented/architecture/2026-06-14-session-persistence.md)），创建新的未发布 agent 作用域，等待可选 setup，并使用相同的最终进入发布序列。其可选 `signal` 同样只用于创建。未注册工厂或未配置会话持久化时拒绝。

`AgentHandle = { agent: Agent; dispose(): Promise<void> }`。Disposer 是一项 **消费方能力**；仅持有裸注册表条目的观察方不能 teardown agent。调用方 fiber 和已注册工厂提供方是结构化共同拥有者：调用方卸载会强制结构化所有权，而工厂卸载必须停止旧实例，因为它们的作用域依赖范围属于该提供方。任意拥有者调用 `dispose()` 都会到达同一个记忆化完全停稳边界：它停止循环，等待循环退出，注销 agent，从存储中移除其会话，最后撤销其作用域世界。`ctx.agents.get(id)` 仍返回裸 `Agent`；ACP 桥接层与进程内 subagent 后端持有消费方 handle，而配置创建的 agent 已由循环 fiber 拥有。

### 实时事件

`dsh-agent` 声明实时 `agent/*` 协调词汇，使插件不必依赖具体循环。确切签名、分发 mode、作用域筛选规则与 payload 约定位于 [core.md](../../../docs/subsystems/core.md#cordis-surface) 的生成区块；[架构轮次流](../../../docs/architecture.md#turn-flow) 展示它们与持久会话事件的相对顺序。

生命周期边有两个重要的本地注意事项。`agent/created` 在作用域 setup 之后、会话与 agent 注册表条目都存在之后运行。Setup 是受信任、仅用于组合的代码；紧随其后且不可 veto 的 `agent/session-start` 通知是第一个受支持的启动注入点。`agent/disposed` 始终表示确切 agent 已离开注册表。AgentLoop 在其驱动器完全停稳后发出该事件，而有序 teardown 此时可能仍在分离会话并撤销作用域；直接注册的自定义 agent 自行拥有任何更强的驱动器顺序约定。

大多数拦截点都是协作式 waterfall（瀑布式事件）。`agent/pre-step` 接收一个 payload，携带主体 `agent`、独占的已领取 `UserMessage[]` 以及拟进入的 `turn`、`step` 与取消 `signal`；当工具已经要求继续请求时，该批次可以为空。agent 作用域轮次扩展点在 payload 中携带显式 `AbortSignal`；其余轮次作用域扩展点通过其请求值接收它。监听器可以配合信号，但不得将它保留为控制另一轮次的权限。`agent/request-error` 是失败模型请求的恢复 waterfall：它接收请求坐标、规范化失败事实、可用时提供服务的注册项重试策略以及信号。拥有恢复权的监听器返回 `{ kind: 'retry' }` 且不调用 `next()`。`agent/turn-stopping` 在本可完成的轮次关闭前运行。信号生命周期由[显式取消决策](../../../.agents/notes/implemented/architecture/2026-07-16-explicit-turn-cancellation.md)拥有；作用域分发与终止结算由 [agent 作用域 runtime 设计 Agent Note](../../../.agents/notes/implemented/architecture/2026-07-12-agent-scope-runtime-design.md#three-execution-boundaries-are-deliberately-one-way)拥有。

`PreStepDecision` 要么是 `{ kind: 'reject' }`，要么是 `{ kind: 'enter', messages }`。enter 分支是拟进入步骤的完整、带标识且冻结的批次。包装下游 enter 的监听器会保留该批次，除非有意替换它；新增消息遵循 waterfall 的自然返回顺序。领取操作已经把候选消息从 inbox 删除，因此 reject 不会保留它们；领取后插入的消息仍等待后续边界。

inbox 的实时通知刻意采用逐消息的最小载荷：`agent/inbox/inserted { message }`、`agent/inbox/claimed { message, turn }` 与 `agent/inbox/discarded { message }`。它们补充持久 `agent/inbox/spliced` 投影，但不引入另一层生命周期封套。

轮次和步骤边界以及模型 token 流是持久 `session/event` 事实，而不是镜像的 `agent/*` 通知。消费方从会话事件流读取 `turn/*`、`step/*` 和 `assistant/chunk`；工具策略与结果观测属于 [`dsh-tools`](../tools/README.md) 记录的完整流水线。

`foldConsumedWork(events)` 把这条事件流读回来，回答仅凭轮次序列无法回答的那个问题：一份日志消费掉的工作最终怎样了。它返回能够为已消费工作作出交代的最新 `turn/end`——即进入过模型 step 的轮次，或者认领了 inbox 输入、但在进入 step 之前失败、被停下或被拒绝的轮次——并额外给出「已接受的工作此后是否被从 inbox 中取消且从未运行」。两项事实都来自日志，因此无论由哪个所有者发起取消，读出来都一样。没有取走任何输入、或认领批次被改写清空后正常结束的无 step 轮次不描述工作，会被跳过；认领过输入、以 `blocked` 结束的轮次则是一份交代，因为拒绝把这些输入一并丢弃了。

### Agent 接口（`types.ts`）

每个插件面向的 handle：

- `agent.inbox`：agent 所拥有的持久 `agent/inbox/spliced` 事件投影。`nextTurn` 与 `nextStep` 暴露待处理的 `UserMessage` 值。`append`、`prepend`、`replace`、`remove`、`clear`、`splice` 与 `claim` 用于变更队列；`replace(messageId, newMessage)` 与 `remove(messageId)` 通过 `MessageId` 跨两份列表定位待处理消息。替换可以改变标识，并先将旧消息作为 discarded 发布，再将新消息作为 inserted 发布。普通删除和 `clear()` 都是持久取消，并发出 `agent/inbox/discarded`。`claim(target)` 通过纯删除 splice 移除下一个候选批次，随后由循环发出 `agent/inbox/claimed`。`MessageId` 是唯一的入队项标识，在消息待处理期间必须保持唯一。
- `agent.followup(message)`：将一条普通 `next-turn` 消息排队并唤醒驱动器。它不返回完成 handle；消息 id 标识 inbox 的插入、领取与丢弃事实，而不标识之后的输出或 `turn/end`。
- `agent.steer(message)`：将会唤醒的 `next-step` steering（中途引导）输入排队。agent 空闲时会同步启动一个轮次；驱动器运行期间收到的后续 steering 会在下一个步骤边界被消费。
- `agent.inject(message)`：将不会唤醒的 `next-step` 上下文排队。运行中的驱动器会在最近的后续 pre-step 边界领取它；idle 驱动器则会让它保持待处理，直至 `followup()` 或 `steer()` 唤醒驱动器。若某次请求的 pre-step 已经领取完批次，它可能赶不上该请求。
- `agent.cancel(cause, options?)`：取消活跃驱动器，并在未设置 `options.keepInbox` 时持久取消全部待处理 inbox 工作。空闲取消是空操作。
- `agent.whenIdle()`：观察整个 agent 达到完全停稳，包括当前驱动器退役前调度的替代工作。它不结算任何特定消息。
- `agent.session`、`agent.status`、`agent.options`、`agent.id`、`agent.ctx`

`running` 描述驱动器范围的 drain 区间，而不是轮次仍打开的证明；它可以覆盖轮次关闭、持久性检查点和连续的排队轮次。只有拥有完整区间的调用方才能将其概括为一次运行的结果（[决策](../../../.agents/notes/implemented/architecture/2026-07-30-followup-enqueue-and-owned-runs.md)）。

### 扩展点

- Agent 创建：`AgentLoop.create()` 是具体配置路径实现（位于 `dsh-agent-loop`），程序化消费方则通过 `ctx.agents.create()`/`ctx.agents.resume()` 创建或恢复有所有权的 agent。替换循环时，应实现 `Agent` 并通过 `ctx.agents.register()` 注册。
- 事件监听器：全部 `agent/*` 事件都在此处声明，不需要依赖循环包。
- subagent 委派不是 `Agent` 方法；提供方通过工厂 API 创建或驱动普通 handle，因此委派传输留在核心 agent 接口之外。

## 模型体验

### 用户、steering 与注入消息

#### 模型看到的内容

`send`、`steer` 与 `inject` 会向所属会话提供输入。`agent/pre-step` 和其他已声明事件让插件能够拒绝拟进入的步骤或添加持久请求材料；此接口本身不贡献固定文案。

#### Token 影响

已接受内容成为保留历史，或成为每次请求都会重复的会话前缀；被阻止内容不贡献请求 token。大小取决于调用方与插件。

#### KV Cache 影响

已接受历史与 steering 只追加；被阻止的提交不发送请求。会话前缀在循环实例内保持稳定，而新建或恢复的实例可能建立不同前缀。

### Agent 作用域的请求组合

#### 模型看到的内容

通过 `agent.ctx` 进行的注册可以遮蔽提示词段或工具，也可以在未发布 setup 期间安装仅适用于该 agent 的拦截器。

#### Token 影响

此包自身不增加 token；带作用域贡献只影响该 agent，并在 dispose 时消失。

#### KV Cache 影响

只要 agent 的作用域注册不变，前缀就保持稳定。改变提示词段、工具定义或请求监听器的 setup 或 reload，可能从第一个受影响的请求 token 起使复用失效。

## 已知限制与暂缓事项

- **发起方作用域只存在于进程内**：worker、子进程、HTTP、持久队列和重启必须显式传递所需身份。
- **环境身份可能比存活状态更久**：消费方在生命周期敏感工作前，仍要检查 `agent.status`、取消状态和所属能力约定。
- **委派以外的 agent 间通道**：共享状态、流式子输出和后台／轮询语义仍在当前同步 `ctx.subagents` seam 之外。
- **`agent/session-start` 不能为启动设置门禁**：它仍是同步且不可 veto 的通知；必须在发布前完成的异步组合属于工厂的 `setup(agentCtx)` 事务。
- **`cancel()` 默认清空 inbox**：它会中止正在处理的轮次以及排队和 steering 工作；`cancel(cause, { keepInbox: true })` 只中止轮次并保留待处理项。仍不存在只中止步骤、同时让正在处理的轮次继续运行的操作（[停止 API Agent Note](../../../.agents/notes/implemented/simplification/2026-06-20-public-agent-stop-api.md)）。
- **每条附加 `UserMessage` 恰好携带一个 `MessageSource`**：多个插件合并到一次工具调用上的贡献会归入同一来源，因此该消息无法列出多个生产者。
- **`SessionStartSource` 预留 `'clear'`/`'compact'`，但还没有发出方**：在驱动子系统落地前，只会出现 `'startup'`/`'resume'`（`TODO(compaction)`）。
