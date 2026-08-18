# @deepseek-ai/dsh-subagent

[English](README.md) | 中文

subagent seam 允许一个 agent（智能体）通过具名提供方把工作委派给子 agent。调用方统一使用 `ctx.subagents` 服务 API；提供方决定子 agent 在当前进程、其他进程，还是通过未来的传输方式运行。

[subagent 家族概述](../README.md)列出了实现和面向模型的消费方。本包负责提供方注册表、共享请求和结果约定、持久描述符以及可继续子级编排。多个具名提供方可以在该约定背后共存。

## 服务 API

`SubagentRuntime` 具有以下操作：

| 成员 | 含义 |
|---|---|
| `registerProvider(provider)` | 按名称注册一个可信的同进程实现。注册受 effect 作用域约束；移除注册会阻止新的启动，但不会撤销已返回给调用方的运行。重复名称会明确报错。 |
| `getProvider(name)` | 返回提供方；不存在时返回 `undefined`。 |
| `list()` | 按插入顺序返回提供方名称。 |
| `start(name, request)` | 校验普通调用方请求，解析其已分离的 `one-shot` 描述符，然后等待提供方发布真正的一次性子 agent。兑现时返回由持有方拥有的 `SubagentRun`；如果调用被拒绝，提供方已经清理所有尚未发布的启动资源。发布后的轮次故障或基础设施故障则通过该 run 结算。可继续子 agent 绝不通过此操作进入。 |
| `startContinuable(spec)` | 建立一个持久化的可继续子 agent，并投递其初始提示词。子 agent 的 inbox 一接受该提示词，调用就会兑现为 `{ childId, messageId }`，无需等待轮次开始，也无需等待消息写入会话日志。在此之前发生的任何失败都会使调用被拒绝，不返回任何 id，并完全回滚该子 agent。要求 `ctx.agents`、会话持久化以及具备 `prepareContinuable` 能力的提供方。 |
| `followup(parent, childId, content, { source, signal })` | 将来自确切在线直接父级的一条后续消息作为子 agent 的下一个 FIFO 轮次投递，术语与 `Agent.followup()` 一致，并返回被接受的 `MessageId`。驻留中的子 agent 由其 inbox 直接接受（唤醒处于 waiting 的 Activation）；不驻留的则从其持久化会话冷恢复。要求 `ctx.agents`；冷恢复还要求会话持久化。 |
| `interrupt(targetSessionId, authority)` | 凭人类出示的持久化父级地址 `{ kind: 'user', parentSessionId }`，或确切在线的祖先 Agent `{ kind: 'ancestor', agent }` 进行授权，中断一个在线可继续子级的当前轮次。准入判定同步完成，但取消异步生效：该操作发出 `Agent.cancel(cause, { keepInbox: true })` 后立即返回，不等待目标观察到信号。尚未领取的待处理 inbox 工作、Activation 和已发布的后代均会保留；已经领取到被中断轮次中的工作不会重新入队。目标不存在时视为已接受的空操作；错误的父级地址，或陈旧、指向自身、并非祖先的调用方，会以 `UNAUTHORIZED` 被拒绝。 |
| `reportFrom(child, content, { delivery, signal })` | 从确切在线可继续 child 向其确切在线直接 parent 投递一条选中消息，并返回已接受的稳定 `MessageId`。静默投递会注入上下文；唤醒投递会提交一个后续 parent 轮次。 |
| `registerContinuableSetup(contribution)` | 把一项可选部署能力组合到每个可继续 child 尚未发布的作用域中，并支持从驻留 child 立即撤销。 |
| `drainContinuableDescendants(parents)` | 在由 host 拥有的确切在线父级 Agent 之下关闭准入，只停止这些父级可见的可继续后代；等待已在这些根节点下获准的物化过程完成发布或回滚后，再按子级优先顺序释放所选的各棵树。该截止状态会持续到每个确切父级离开注册表；无关的父级树仍在线，管理器全局准入仍保持开放。 |
| `listChildren(parentSessionId, signal?)` | 按 `createdAt`、再按 id 的顺序列出由会话支撑的直接 subagent，包括其 `one-shot`／`continuable` 模式、`running`／`inactive` 活动状态、根据 origin 分类得出的一层 `hasChildren` 提示，以及每个子级的诊断信息，且不会加载或恢复它们。该操作直接读取在线会话存储和可选的会话持久化（没有持久化时只枚举在线子级），并要求已挂载 `sessionProjections` 注册表；不要求 `ctx.agents`、继续执行管理器或任何查询服务。 |
| `listDescendants(rootSessionId, signal?)` | 从同一份在线优先语料按稳定 pre-order 展平根的完整会话树，并为每个 subagent 条目附加持久 `parentId` 与相对根的 `depth`。普通会话与一次性 child 仍作为遍历节点，因此其下的可继续后代仍可发现。身份、diagnostic、依赖与取消约定均沿用 `listChildren()`。 |

`SubagentStartRequest.label` 是由会话支撑的一次性 child 所使用的可选简短持久化显示标签。面向模型的委派会提供其已有的 `description`；底层调用方无需凭空构造展示元数据。可继续启动始终携带自身的必填标签。`signal` 是必填项，也是一次性 `start` 的规范取消通道。发布前中止会使 `start()` 在回滚后拒绝；发布后中止会取消已返回 run 的剩余轮次工作，但不会隐藏其 id。请求还可以选择模型、要求结构化输出、限制委派深度、约束子 agent 工具或设置子 agent persona。对于可继续启动或后续操作，调用方信号只负责 inbox 接受前的查找、物化和准入；此后，Activation 由管理器独立拥有，因此调用方取消既不会取消已接受的轮次，也不会 dispose（资源释放）子 agent。

后续操作的权限来自子 agent 持久化 header 中记录的确切在线直接父级。冷恢复会在重建前检查该权限，并在最终无 await 的 inbox 准入区间再次检查，因此在物化期间被注销或替换的 parent 无法授权投递。后续操作上的 `source` 记录谁提供了所投递的消息，不授予任何权限。

同进程请求、描述符、结果和事件 payload 都是可信的类型值，并按不可变约定借用。服务不会克隆或冻结它们；序列化和不可信输入校验属于真实的进程、worker、持久化和模型边界。

## 能力

启动时功能通过 `provider.capabilities` 声明，因为服务必须在创建子 agent 前拒绝不受支持的一次性请求：

- `outputSchema`：强制执行结构化最终结果；
- `depthLimit`：强制执行 `maxDepth`；
- `toolFilter`：应用请求的子 agent 工具限制；
- `persona`：应用每个子 agent 独立的 persona。

每个进程内子 agent 都通过一次 `applyChildComposition(childCtx, parent, composition)` 调用完成组装：先加入父级的 agent-preset 组合，再应用子 agent 自己的 persona 和工具限制。加入父级组合正是子 agent 获得能力的途径：所有面向模型的行都位于 agent 平面，完全没有加入任何组合的子 agent 抵达模型时会看到空的工具注册表（见 [`dsh-agent-presets`](../../preset/agent-presets/README.md)）。将父级作为参数是刻意设计：这让“组装子 agent 却不做该加入”在各调用点无法表达，而这正是这一次调用所要杜绝的缺陷。未组装 preset roster 的部署不加入任何组合、也不需要加入；其面向模型的行位于宿主组合中，子 agent 已能通过工具注册表的全局层解析到它们。

`childSessionMeta()` 把所加入的 preset id 记在子 agent 的持久化 header 上，理由与顶层会话记录自己的那一个相同：preset 决定了模型所见的工具 schema 与提示段，因此冷读子 agent 的历史时必须重建那份组装，而不是部署默认值。该值从父方**活着的** scope 链读取，而不是从父方 header 读取，因为在空白期切换过 preset 的父方运行在更新的那份组装上，而它的 header 仍写着旧的那个。

可继续创建对应可选的 `SubagentProvider.prepareContinuable?()` 方法：方法是否存在就是能力检查，因此服务会在没有该方法的提供方上拒绝已配置的可继续启动，而具备该方法的提供方仍可服务普通一次性委派。该方法只返回已分离的 `ContinuableCreateSpec`（`{ seed? }`）。它只是数据，不携带任何能力：不包含 Agent、`AgentHandle`、提示词投递、结果、dispose 或恢复操作。准备完成后，身份预留、组合、Agent 创建、提示词投递、冷恢复、所有权和 dispose 均由继续执行管理器负责。一次性 `SubagentRun` 表示一次可 dispose 的前台委派，只有一个结果，且没有冷恢复操作。服务可以针对不同的同级子 agent 并发调用同一提供方：每次启动或准备都拥有各自的可变状态和取消路径，一项操作的失败、结果或清理不得使另一项操作结算或释放。提供方可以在内部按自身容量排队，但不得改变这项独立性约定。

## 持久化描述符

该 Service Definition 拥有版本化的 `subagent/descriptor` 会话事件词汇（`src/descriptor.ts`）：`snapshotSubagentDescriptor()` 会在提供方工作之前校验并分离记录，`foldSubagentDescriptor()` 则会在从已加载子 agent 日志中恢复描述符之前，校验当前版本的完整 payload。每次由本地会话支撑的启动都会追加一个带有提供方名称与生命周期 `mode` 的描述符。`one-shot` 描述符可以携带调用方拥有的可选持久化显示 `label`；`continuable` 描述符要求其持久化创建标签，并另外记录已解析的子 agent `agentOptions.provider`／`model`，以及用于从持久化存储恢复的可选 `persona`／`toolFilter`。这些是显式字段，绝不是可通过合并扩展的 `AgentOptions` 对象，因此无关的扩展值不会破坏继续执行。描述符省略 `subagentDepth`（持久化 header 的 `delegationDepth` 是单调下界）和 `outputSchema`（单次 Activation 的结果约定）。该事件只进入日志：不含 `surfaceOp`，不进入模型历史，并由仅追加日志跨压缩（compaction）保留。格式错误的当前版本 payload 属于损坏；本运行时无法对不受支持的版本进行分类。

## 委派深度

该 seam 拥有 Service Provider 和 Consumer 共享的深度词汇：`AgentOptions.subagentDepth` 声明、`assertSubagentMaxDepth` 和 `delegationDepthOf(agent)`。持久化的 `SessionHeader.delegationDepth` 具有权威性且单调：运行时选项可以增大委派深度，但绝不能将其降到这个下界以下，因此恢复后的子 agent 不会被重新计为顶层。

`inheritsParentContext` 只用于描述，不能强制执行。它仅说明子 agent 是否能看到父级已完成的对话历史（`fork` 可以；`spawn` 和各进程外一次性提供方不可以），不表示是否继承工具、服务或权限。

## 委派策略

两条进程内委派路径都会通过共享的子 agent 辅助函数，在委派边界固定子 agent 的权限范围。`captureDelegatedPolicyOverrides(parent)` 会为父会话的显式沙箱覆盖项（`sandboxPolicy.overrideOf()`）创建快照，并在审批能力已组合时将子 agent 的审批策略固定为 `'never'`，无论父级自身采用何种策略。这样，被委派的子 agent 只能在继承的沙箱范围内行动，每次审批请求（例如 `sandbox_permissions` 升权）都会被确定性拒绝，而不会等待无人处理的提示（这两个服务都是可选的 `ctx.get` 消费方）。`appendDelegatedPolicyOverrides()` 则在未发布的设置阶段、在任何 fork 种子之后，把每个值作为一条 `source: 'delegation'` 的 `sandbox/mode` 或 `approval/policy` 事件写入子 agent 自己的日志。因此，新捕获的策略会覆盖种子中的陈旧状态，而子 agent 的生效策略始终可以仅凭其日志重建。沙箱的部署默认值绝不复制：未切换的父级不会记录 `sandbox/mode`，其子 agent 会动态跟随部署默认值。可继续启动会在第一次 await 前捕获策略，并且只为全新物化写入这些委派事件；冷恢复只会重放已持久化的委派事件，不会重新捕获父级策略，因此创建之后的父级切换绝不会追溯性地改变持久化子 agent。每个进程内子 agent 还会收到一条作用域内的运行时上下文声明（`subagent:delegation`），告知其权限范围已固定，需要更宽访问的任务应以上报限制收尾，而不是重试。参见[一次性](../../../.agents/notes/implemented/feature/2026-07-25-subagent-policy-inheritance.md)与[可继续](../../../.agents/notes/implemented/feature/2026-08-10-continuable-subagent-policy-inheritance.md)两篇委派策略 Agent Note。

## 一次性所有权与生命周期

`provider.start(request): Promise<SubagentRun>` 是所有权转移边界；委派工具也会在其由 Task 支撑的一次性后台路径中使用它。兑现前，提供方拥有设置过程，并且在任何失败路径上都必须取消、回滚并使尚未发布的资源完全停稳。兑现后，run 的所有权转移给调用方；调用方必须在每条路径上调用 `dispose()`。剩余提示词和轮次工作属于 `SubagentRun.result`。

`SubagentRun.result` 兑现为 `{ output, structured?, stopReason }`。子 agent 级失败会以非 `completed` 原因兑现；只有 seam 无法表示的基础设施故障才可以拒绝。`dispose()` 是幂等的，会取消剩余工作，并等待结果结算以及子 agent 资源完全停稳。result 的拒绝只通过 `result` 本身报告；只有独立的资源释放失败，才会使 `dispose()` 被拒绝。`output` 与 `subagent/end` 事件的 `lastAssistantMessage` 使用导出的 `AssistantOutputFold`／`finalAssistantOutput` 辅助函数选取子 agent 最后一条非空 assistant 消息；若没有这类消息，则选取其累积的 assistant 文本。子 agent 两种输出均未产生时，`output` 为 `[]`，该事件字段缺省（结果约定归 [`SubagentResult.output`](../../../docs/subsystems/subagent.md#the-terminal-result-subagentresult) 所有）。

本地运行会在 `start()` 兑现前发布普通的子 agent／会话，把该共享会话 id 作为 `SubagentRun.id` 返回，以 `SubagentRun.localAgent` 公开准确的子 agent，把 `request.parent.session.id` 记录到子 agent 的 `parentSession` header，并在其初始轮次内追加已解析的描述符。远程提供方则生成 parent 作用域的生命周期 id，并返回 `localAgent: undefined`；由于没有本地 child 会话，其一次性运行不会进入基于追踪的枚举结果。

## 可继续子 agent 与 Activation

每个可继续子 agent 都有一个持久化 Session，并且同一时刻至多有一个进程内 **Activation**。Activation 表示重建后的子 agent 的一次驻留时段，不是请求、结果、取消或 Task 的边界。Agent inbox 是唯一的轮次队列，因此驻留归继续执行管理器，所有轮次排序与执行归 agent loop（智能体循环）。任何可继续路径都不会创建 Task 或中间的承载结果的包装层。

管理器根据 Agent 的完全停稳状态和所拥有的子级集合推导三种内部驻留状态，而不维护第二套状态机：running 表示存在正在进行的准入、尚未结束的轮次，或会唤醒 Agent 的 inbox 工作；waiting 表示 Agent 已完全停稳，但仍拥有至少一个尚未 dispose 的子级；settled 表示 Agent 已完全停稳且所有拥有的子级均已 dispose，此时管理器会 dispose `AgentHandle` 并移除 Activation。每条后续消息都使用 `Agent.followup()` 并成为一个 FIFO 轮次，且不会对当前轮次进行 steering（中途引导）。路由只取决于驻留状态：running 入队、waiting 唤醒同一 Agent，无 Activation 时则冷恢复一个新的。

管理器预留子 agent 身份、解析持久化描述符，通过私有的 activation-owner 作用域调用 `ctx.agents.create()`（冷恢复时为 `ctx.agents.resume()`），把返回的 `AgentHandle` 安装到 Activation 中，建立任何可继续父级所有权，然后提交提示词。冷恢复绝不通过提供方分发，因为持久化会话已持有初始前缀，折叠后的描述符即是全部重建输入。

### 结算投递

当一个驻留 Activation 结算时，管理器会在父级自身的轮次流中告知该子级持久化的直接父级：这个子级已经产出它将产出的全部内容。对于每个已经向调用方返回过 id 的子级，管理器都会无条件投递结算通知，不考虑该子级是否调用过 `report`。最需要说明结局的终止情形，包括达到 token 上限、模型失败、取消或拆卸，恰恰是子级根本没有机会选择的那些情形。在第一条消息被接受之前就回滚的物化保持静默，因为那位调用方已被告知该子级未建立。消息会携带该 epoch 的终止原因、它产出过的最终 assistant 内容，以及持久化来源 `{ kind: 'subagent-settled', form: 'notice', senderSessionId: <child-id> }`——与子级自撰的 `subagent-report` 是不同的来源 kind，因此 transcript（文本记录）绝不会把运行时写下的话算到子级头上。

有两条顺序规则让这条投递可靠而非侥幸，它们也正是这件事属于管理器而非外部 `subagent/end` listener 的原因。第一，发送发生在子级所有权释放**之前**，此时父级仍然计入该子级，因此在结构上不可能被判定为已结算。第二，如果父级本身也是驻留 Activation，该消息会采用与 report 相同的唤醒准入记账。这样，从同步发送消息到负责准入该消息的 microtask 运行之间的窗口，不会被误判为完全停稳——`Agent.status` 会把上下文维护折叠成 `idle`，而维护期间的唤醒发送只会预置一次延后唤醒。缺少其中任一条规则，父级都可能在通知仍留在 inbox 时被 dispose，而 `cancel()` 会清空该 inbox，于是通知被静默丢失。

空闲父级会以一个普通的后续轮次收到该通知。繁忙父级则被 steer 到其最近的 step 边界，因此同时结算的多个子级只消耗一个 step，而不是各自一个轮次；采用 steer 而非 inject 还意味着：即便驱动在状态读取与发送之间退出，该消息仍会被认领。如果父级所在的谱系已经开始排空，该通知会通过 inject 投递，且完全不会唤醒父级。对已经完全停稳的父级调用 `Agent.followup()` 会开启新轮次，而 `cancel()` 不会预先阻止之后开启的轮次；因此在拆卸期间唤醒父级，会让宿主即将 dispose 的 Agent 多执行一次模型请求，而且树的每一层各一次，因为每层自己的通知又会唤醒上一层。被 inject 的消息会送达仍在读取自身 inbox 的父级，而无论如何日志都会记录这份记账；但它不会比该父级自身的 dispose 活得更久：`AgentHandle.dispose()` 是一次 `keepInbox: false` 的 cancel，会持久地取消尚未被认领的通知。因此 resume 后的父级没有待处理通知可读：`list_agents` 只告诉它有哪些子级、各自是在线还是仅存于存储；结局本身留在子级自己的 Session 里，一次 `send_message` 会通过 resume 该子级把它取回。已离开注册表的父级不算错误：通知被丢弃，子级自身的 Session 仍是持久记录。投递绝不会阻塞或使拆卸失败——发送被拒只会记录日志，因为为了重试一条通知而保留子级，会把它的整条祖先链永久钉在 `waiting` 上。

受继续执行管理的父级 Activation 会在子 agent 能够运行之前，把每个子 agent 的会话 id 记录到 `ownedChildren` 集合中，并且只有在每个所拥有的子 agent Activation 完成 `AgentHandle` dispose 之后才会 dispose（子先于父）。拆卸会先自顶向下传播 Agent 取消，再等待缓慢的后代，而 handle 释放仍保持 child-first。顶层及其他非继续执行的 Agent 没有 Activation，处于该等待图之外。最终结算会在 dispose handle 前等待 best-effort 的 `ctx.sessions.flush(child.session)`。监听器拒绝会被记录，但不会使 Activation 失败，因为监听器参与本身不能标识持久化后端；因此恢复时的持久化状态仍可能缺失或陈旧。

## 生命周期事件

服务会为每次一次性运行以及每个已驻留的可继续 Activation 时段发出一对 `subagent/start`/`subagent/end`，因此可继续子 agent 可用与一次性运行相同的词汇观察，且不会暴露管理器是物化、唤醒还是冷恢复了它们。对于一次性启动，它会在同步的 `subagent/start` 之前附加结果观察器，因此即使子 agent 已经结算，也仍会先产生 `subagent/start`，再产生 `subagent/end`；在驻留前失败的可继续时段不会发出这对生命周期事件中的任何一个。这对事件共享由服务生成的 `runId`；`local` 标志根据提供方返回的确切 `localAgent` 是否存在取得快照（可继续子级恒为 true），因此观察器不会根据可复用的提供方名称或会话名称推断运行身份或本地性。`provider` 字段包含子 agent 初次创建时记录的提供方名称，不表示该提供方当前仍在注册：已接受的一次性 run 可在提供方移除后才结算；冷恢复时段会从描述符读取初始提供方名称，不会调用或注册该提供方。

运行事件受执行委派的父级作用域约束。每个监听器都独立隔离：同步抛出或返回的 promise 被拒绝时，只会记录日志，不会阻塞同级监听器或改变运行。

提供方新增和移除还会发出 `subagent/provider-added` 与 `subagent/provider-removed`。面向模型的工具等消费方使用这些事件，因为 Cordis 可能并发加载同级插件；配置顺序不能证明注册顺序。

可继续子级不会创建 `SubagentRun` 或 Task。继续执行管理器为每个驻留子会话直接拥有一个仅存在于当前进程的 Activation 和一个留存的 `AgentHandle`，使用 Agent inbox 作为唯一 FIFO，并从持久化描述符冷恢复。父到子投递由确切在线的直接父级身份授权。上报则由确切在线的子级身份授权；管理器根据持久化的 `parentSession` 推导接收方，`MessageSource` 记录发送方，但不授予权限。中断权限被刻意设计得比投递权限更宽：人类出示持久化直接 parent 地址，因此即使 parent Agent 离线，在线 child 仍可被停止；Activation 物化时记录的任何确切在线 ancestor 也可以停止其后代，因为停止一个轮次是幂等的，且不投递任何内容。

当 `ctx.sessionProjections` 可用时，服务会注册两个投影单元。`subagentTiming` 会在每个描述符处重置，使 fork 种子中的祖先工作不会计入 child 总量，随后累加 `turn/start` → `turn/end` 活跃时间，并为未结束的轮次保留同一切面的 `active.since` 和 `active.through` 边界；在该轮次保持未结束期间，`active.through` 会跟随最近折叠的事件，从而为 inactive 消费方提供保守的崩溃上界，又不会混入更新的会话元数据。`subagent` 以同样的 last-wins 重置纪律从 `subagent/descriptor` 事件折叠持久化身份——模式与创建标签——因此 fork 种子中的祖先描述符只在 child 自身的描述符覆盖之前有效；畸形或版本无法识别的载荷折叠为可序列化的 `null` 哨兵——与没有描述符的日志不可区分，且能完好通过每个 JSON 推送帧，让消费方以之替换掉手中的陈旧身份而非继续保留该身份——绝不抛错。

`registerContinuableSetup()` 允许可选包添加子级作用域能力，而无需让继续执行管理器知道这些能力的名称。贡献会在 Activation 发布前同步安装，在设置失败时一并回滚，并随子级作用域释放。新授权须等到下一个 Activation，移除贡献则会立即撤销每个驻留安装项。

## 收集模型

面向模型的工具默认同步收集：先等待子 agent 结果，再 dispose 运行，然后才返回。一次性后台委派会在工具中注册普通 Task，其通用状态、收集和取消工具负责后续交互，并将模型提供的 `description` 持久化为可选显示标签。可继续后台委派会调用 `ctx.subagents.startContinuable()`，只返回持久化子 agent id；子 agent 自 inbox 接受起就拥有自己的轮次，因此没有 Task、也没有结果 promise——调用方通过 `send_message` 后续操作工具发送后续工作，`interrupt()` 只停止当前轮次而不 dispose 子 agent，而持久化子 agent 会话仍是子 agent 详细输出的来源。只有 `ctx.agents` 可用时，继续执行管理器才会存在，而会话持久化按每项继续执行操作解析。与此独立，`listChildren()` 枚举在线会话存储与可选会话持久化的在线优先合并——持久化缺席时仅枚举在线 child，因为那时冷 child 本就无法恢复——并由已注册的 `subagent` 投影单元供给每个 child 的持久化模式与标签：在线 child 取注册表的水位快照；冷 child 先取可选投影缓存的持久化行，且仅当其 `seq` 门证明该值折叠自 child 自身后缀（fork 种子之后——自有描述符一经追加即不可变）才直接采用，否则经一次有界并发的持久化 inspect 再经注册表折叠，且 inspect 结果必须仍指向枚举时的生命周期（同 id 被重新发布的会话降级为 `corrupt` diagnostic）。缓存读取抛出异常时，不会据此作出分类判断，因为缓存只是派生数据；静默落到该权威重折。分类结果完全以投影折叠为准；列表操作本身不解析描述符。取得身份值即产出 child 行；已定局而折叠未产出身份的候选是 `corrupt` diagnostic，inspect 失败是瞬时的 `unavailable`（下次列表重试），运行中而暂无身份值的候选整行省略（描述符尚未追加的创建窗口）。它不查询继续执行管理器、Agent 注册信息、Activation 或提供方。每个 child 行都会根据合并结果中携带持久化 `origin: 'subagent'` 的 header 派生读取时的 `hasChildren` 提示；它不会读取后代事件日志，展开后仍以描述符支撑的 child 目录为权威依据。UI 等服务消费方可以保留两种模式，并为无标签的一次性 child 选择回退展示；面向模型的 `list_agents` 工具只投影 `continuable` 条目，通过在线 Agent 注册表细化状态，并把仅存于存储的状态映射为可恢复而非终态的 `ready`（`running`／`idle`／`ready`），并在 `descendants` scope 下遍历 `listDescendants()`。列表操作会把调用方的取消信号转发到每次持久化读取，在这些 await 前后检查取消，并将每次检测到的中止报告为 `SubagentError` 错误码 `CANCELLED`；投影注册表未挂载则以 `SUBAGENT_CONTROL_PROJECTIONS_UNAVAILABLE` 响亮失败，会话存储缺失则以 `SUBAGENT_CONTROL_SESSION_STORE_UNAVAILABLE` 响亮失败。完整约定见[后台 subagent 任务 Agent Note](../../../.agents/notes/implemented/feature/2026-07-08-background-subagent-tasks.md)、[可继续后台 subagent Agent Note](../../../.agents/notes/implemented/feature/2026-07-21-continuable-background-subagents.md)、[持久化目录 Agent Note](../../../.agents/notes/implemented/feature/2026-07-22-durable-subagent-catalog-and-list-agents.md)、[服务合并 Agent Note](../../../.agents/notes/implemented/simplification/2026-07-26-merge-subagent-control-service.md)、[能力 seam Agent Note](../../../.agents/notes/implemented/feature/2026-06-21-subagent-capability-seam.md)和 `src/types.ts`。

可继续 Activation 会等待 best-effort 的最终会话 flush，但不会把 listener 参与视为持久性确认。一次性运行保留尽力执行的会话检查点，因此已完成的一次性 child 只有在其会话确实进入持久化存储时，才可在 dispose 后继续被发现；如果该检查点缺失，服务不会根据 Task 历史虚构目录条目。

## 模型体验

### 结算通知

#### 模型看到的内容

一条用户角色的父级消息，开头是结果本身——`Background subagent <child-id> finished and will do no further work unless you send it more.`，或子级被停止、耗尽额度、拒绝任务或失败时的对应句子——随后是 `Its closing message:` 与子级的最终 assistant 内容；若子级没有产出内容，则是 `It left no closing message.`。这是本服务面向父级的唯一直接贡献；委派 schema、父级延续与发现以及子级作用域的 `report` 分别归 `dsh-tool-subagent`、`dsh-tool-subagent-control` 和 `dsh-tool-subagent-report` 所有。

#### Token 影响

父级请求中，每个已结算的 Activation 一条通知，长度取决于子级的最终消息。如果子级既上报又结算，父级请求会同时承担上报消息和结算通知两部分 token 开销。

#### KV Cache 影响

在父级中仅追加：通知位于其可复用请求前缀之后。到达空闲父级会启动一次独立的模型请求，到达繁忙父级则不会。

### 子级委派范围声明

#### 模型看到的内容

每个进程内子 agent 的运行时上下文快照都携带下方的 `subagent:delegation` 声明，位于沙箱策略与审批策略语句之后。

##### 委派范围声明

```markdown
You are a delegated subagent: your permission scope was fixed when you were started and cannot be widened from inside this session — operations that require approval are rejected automatically. When the job needs access beyond that scope, do not retry the denied operation; state the limitation in your reply so the delegating agent can handle it.
```

#### Token 影响

每个子 agent 的运行时上下文快照中一条固定声明；父级请求中没有任何新增。

#### KV Cache 影响

子级内部前缀稳定：该声明在子 agent 生命周期内绝不变化，因此只写入第一份运行时上下文快照一次。父级侧不会直接使缓存失效；具名工具消费方共同负责请求前缀的任何变化。

## 已知限制与暂缓事项

- **ACP 子 agent 仍为一次性，且无法通过追踪枚举**：ACP 运行在 parent 会话语料中没有本地 child 会话。ACP 的 `prepareContinuable` 需要在提供方专用描述符数据中持久化远端会话 id，以及逐子 agent 的继续执行能力声明，因为 ACP 的 `loadSession` 支持按子 agent 协商，而不是通过方法是否存在来确定。远程提供方还需要一份独立的 Activation 所有权约定，具备等效的经认证控制和子先于父的完全停稳保证，才能支持可继续子 agent。
- **无 host-user 继续执行**：`followup()` 要求确切在线直接父级。只有 `interrupt()` 接受持久化 parent 地址形式的用户授权，因为停止一个轮次是幂等的且不投递任何内容；未来 host 适配器需要具体的经认证交互，才能让该 seam 获得用户投递能力。
- **不对当前轮次进行 steering**：可继续消息和唤醒式 report 会排入后续轮次，均不会重定向正在进行的轮次。
- **取消收敛期间存在唤醒缺口**：中断信号发出后、活动 driver 进入 idle 前被接受的唤醒型 follow-up 会保持排队，直到另一条唤醒发送到达。Issue #1838 负责 agent-loop 的唤醒锁存；普通会话取消也受此影响。
- **驻留仅限进程内**：Activation inbox 与所有权图不会在两个 harness 进程之间协调；对单个持久化存储的并发访问仍然需要持久化邮箱和跨进程租约协议。
- **不回放已接受但未记录的消息**：只有写入子 agent 会话日志的消息才能连同提供该消息的来源一起重建。崩溃可能丢失从未写入日志、已被接受的初始提示词或后续消息；此后一条经授权的消息可以冷恢复该子 agent，但丢失的消息不会自动回放。
- **没有持久化的上报 mailbox**：上报需要在线直接父级，提供的是接受标识，不保证恰好一次投递，也不提供已读回执。
- **生命周期事件只供观察**：影响运行的 `subagent/end` 延续或决策接口仍需等待具体消费方。
