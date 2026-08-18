# dsh-session

[English](README.md) | 中文

事件溯源的会话日志和内存存储。`Session` 是 agent（智能体）全部交互历史的仅追加真源，LLM（大语言模型）消息历史由它*派生*。原始日志之上维护一个 **surface** 层（产生消息事件的有序投影），以便高效派生和压缩（compaction）。

可选配套入口 `@deepseek-ai/dsh-session/invariant` 将此包的关系轨迹检查注册到 `ctx.invariants`：序号单调递增、轮次／步骤闭合，以及同一步骤内的工具调用／结果配对。加载或重新加载时，它会回放现有会话；存储校验、快照、冻结、被引用的源事件校验和 surface 准入仍始终由根会话包负责。

## 服务：`SessionStore`（ctx 键：`sessions`）

创建并持有事件溯源的 `Session` 实例。这里有意不实现持久化：插件订阅 `session/event`，在 `session/flush` 时刷新，并可镜像成对的 `session/created`／`session/disposed` 生命周期。

### 公共 API

- `ctx.sessions.create(id?, { seed?, meta? }?)` 校验持久种子／头部数据并生成脱离副本，补齐版本和 id，在未提供 `createdAt` 时使用当前时间，发布会话并将其绑定到调用方 fiber。持久化重建会提供原始的 `createdAt`、`seedLength` 和 `delegationDepth`。
- `ctx.sessions.flush(session)` 通过会话捕获的作用域分发一个需等待完成的并行持久性检查点。每个监听器都会启动；调用会等待全部结算后才报告失败。未发布、已脱离和陈旧的对象会被拒绝。
- `ctx.sessions.fork(source, boundary?, childSessionId?): Session`：解析实时会话对象或 id，选取截至 `boundary` 事件序号（含该事件）的种子（默认为当前最后一个事件），要求所选前缀结束时没有开放轮次，再创建带谱系元数据的实时子会话。
- `ctx.sessions.get(id: SessionId): Session | undefined`
- `ctx.sessions.list(): Session[]`

#### 高级：有序清理生命周期原语

仅在清理必须与另一项资源排序时使用拆分生命周期：

- `prepare(id?, options?)` 校验并构造，但不发布。
- `enter(session)` 执行冲突检查，在不通知的情况下发布，并返回一个绑定到该条目的幂等脱离函数。允许并发准备相同 id，但只有一个条目能够成功进入；陈旧的脱离函数无法移除其替代项。
- `announce(session)` 发出唯一一次创建边，并拒绝重复或重入通知。该次分发期间请求的脱离操作会延后，之后再发出成对的释放边；未通知的条目不会发出任何生命周期边。

`dsh-agent-loop` 使用这一拆分，以保证循环的最终刷新先于会话脱离；详见[所有权 Agent Note](../../../.agents/notes/implemented/architecture/2026-06-18-agent-lifecycle-and-ownership-contracts.md)。

### 实时服务事件

会话存储会将已通知的创建与释放配对，在提交后发布追加通知并逐个监听器收容失败，同时提供受等待的持久性检查点。确切签名和作用域行为见 [session.md](../../../docs/subsystems/session.md#cordis-surface) 的生成区块；载荷见[持久化目录](../../../docs/persistence-catalog.md)。

### 类：`Session`

普通类（不是 Cordis 服务）。活跃会话通过 `ctx.sessions.create()` 创建，脱离态的回放或检查会话通过 `Session.create()` 创建；脱离态工厂不会发布生命周期事件，也不会将会话绑定到 fiber。

- `session.append(type, data, opts?)` 会为持久数据和 surface 元数据制作快照并冻结它们，校验标记形态、被引用的源事件 seq、替换覆盖完整性，以及仅修改内容的单个 `tool/result` 重写，随后同步提交，再在彼此独立的失败收容下通知观察者。对已挂接会话的重入追加会被拒绝，运行时检查也覆盖扩宽后的联合类型和已加载日志。
- `session.deriveMessages()` 对每个新的 surface 条目只做一次增量投影，并返回一个新数组，其中包含这些条目存储的完整、带标识且冻结的消息。assistant 消息的模型来源会保留生成该消息的提供方和模型，以及适配器私有回放状态。surface 重写会重建投影；不存在原始日志回退。
- `session.deriveEventMessage(event)` 是重建和请求检查使用的规范逐事件投影。
- `session.surface` 暴露只读 `SessionSurface` 视图，由会话唯一的增量 surface 管理器所有；每次提交重写，`replaceGeneration` 都会变化。
- `session.events` 是按追加失效的缓存冻结快照；已接受事件保持深度冻结。
- `session.seq`、`session.id`：当前序号和只读类型化身份。
- `session.header: SessionHeader`：脱离、深冻结的创建元数据（`version`、`id`、`createdAt`，以及可选的 `cwd`／`parentSession`／`seedLength`／`delegationDepth`）。构造时会校验持久记录，并要求其中的 id 与 `session.id` 一致。

### 无损 JSON 工具

持久值需要一种已接受的表示，不能先检查再二次读取。`isJsonValue(value)` 是布尔判断函数；`snapshotJsonValue(value)` 在一趟迭代中校验并复制普通值，无效输入返回 `undefined`，getter 抛出的异常则向外传播。快照辅助函数接受除 `-0` 外的有限 JSON 数值（JSON 会将其改写为 `0`）、稠密普通数组、普通对象或 null 原型对象；它会在规范化前拒绝循环引用、不支持的标量和特殊原型，同时不施加调用栈深度限制。

会话事件导入将所有权与消息校验分开处理。`snapshotSessionEvent(event)` 会先克隆借用的事件，再校验并冻结其中带标识的消息。`adoptSessionEvent(event)` 原地执行相同的消息处理并返回原事件；调用方只有在移交独占的对象图，且该对象图没有与其他事件共享可变子对象时，才可以使用此函数。

### 分片行存储编解码器（`chunk-rows.ts`）

共享的[存储编解码器](src/chunk-rows.ts)在事件序列与紧凑行之间无损转换。它会逐字保留无法识别的事件，并拒绝形态错误的编码行；是否启用打包写入由持久化后端决定。

### Surface 类型

此包拥有有序 surface 投影、替换校验、回放，以及区分追加来源事件与替换事件的类型守卫。[surface 类型目录](../../../docs/subsystems/session.md#surface-types)拥有精确形状与字段语义。面向人的 transcript（文本记录）必须投影追加来源事件，而不是 `session.surface`，因为已落地的替换会遮蔽读者已经看到的历史；面向模型的消费方继续读取 `session.surface`。

### 请求头重建（`request-header.ts`）

`request/header` 记录非历史请求封装的完整规范快照，其原因为 `initial`、`resume` 或 `change`。其可选 `adapterDefaults` 映射会标记由精确模型解析填入的生效 `reasoningEffort` 或 `maxTokens` 值，使下一次请求提议能够将它们与显式对话设置区分开。`foldRequestHeader()` 选择最新快照；旧版增量事件和已移除的 `fallback` 原因会被拒绝。详见[可重建请求 Agent Note](../../../.agents/notes/implemented/architecture/2026-07-05-reconstructable-requests.md)。

`user/message` 会直接存储完整的 `UserMessage`，其中包括收件箱路由或进入步骤前创建的标识。无论它是直接人类提示词、合成注入，还是已进入的 Goal Round，都会原样呈现其 `content`；带类型的 `source` 是区分三者的唯一通道，并携带各领域专有的持久事实。`assistant/message` 和 `tool/result` 也会存储完整的消息值。轮次执行仍由 `turn/start` 与 `turn/end` 包围；`agent.inject()` 会把输入排队，直到后续某次 pre-step 领取它，并在 enter 决策中返回它。

`tool/result` 持久保存一条带标识、user-role 的工具结果消息，以及可选内部失败标识和可选呈现元数据。工具成功时的规范 `value` 和便于人类阅读的规范失败消息只存在于执行本地；渲染后的错误内容是回放权威消息。

### 会话事件词汇（`types.ts`）

生成的[持久化日志事件目录](../../../docs/persistence-catalog.md)逐成员列举仅追加日志的事件类型、载荷、surface 标记与声明位置。Token 记账读取每个步骤的 `assistant/chunk { type: 'usage' }` 记录；如果没有用量分片，则将 `assistant/message.usage` 作为已提交步骤的后备。失败的模型请求尝试没有 assistant 消息。每条 `assistant/message` 都会记录提供方、模型和可选回放状态。

`SessionEventMap` 可通过合并扩展：插件使用声明合并添加自身类型（压缩 seam 的 `compaction/*`、有界恢复的非 surface `llm/retry`、钩子桥接层的 `hook/*`）；合并成员会出现在同一目录中。插件拥有其合并事件的关系不变量，包括是否允许纯日志事件出现在轮次之间。需要持久性的生产方通过 `Session` 追加，再等待 `ctx.sessions.flush(session)`，无需虚构一个执行轮次。

此包还定义 `TurnEndReasonMap`，即用于轮次结束、可合并扩展且以 `kind` 为标签的和类型。`turn/start` 只携带轮次编号；随后已进入的 `user/message` 批次记录其输入，`llm/retry` 则记录请求恢复。

被中断的实时轮次以 `{ kind: 'aborted', reason: AgentCancelCause }` 结束，在持久 transcript 中保留类型化取消原因。持久化会将受支持旧格式中的粗粒度中止结果导入为 `{ kind: 'aborted', reason: { kind: 'legacy' } }`，因为该记录没有保留调用方。轮次失败携带 `{ kind: 'error', error }`；只有崩溃恢复会合成 `{ kind: 'interrupted' }`。

每个 `SessionEvent` 都有三个可选顶层字段（结构元数据）：

- `sourceEventSeqs?: number[]`：被引用为来源的较早事件 seq（例如 `assistant/message` 引用的 `assistant/chunk` seq，或压缩替换条目引用的已遮蔽条目）。对于 `assistant/message`，存在的 `[]` 表示已知提供方流为空；省略则表示旧版或外部事件没有记录源流。其他 surface 事件若有此字段，则要求非空列表。
- `surfaceOp?: SurfaceOp`：事件进入 surface 的方式。非 surface 事件（边界、分片、用量、错误）不含该字段。
- `ignorable?: true`：标记读取器在不认识事件类型时可以安全跳过该事件；缺失表示必需，不认识的事件类型会使会话重建被拒绝（[机制](../../../.agents/notes/implemented/architecture/2026-08-10-session-log-version-mechanism.md)）。

### 元数据类型（`types.ts`）

- `SessionHeader`：会话元数据，在发布为 `Session.header` 时写入一次；脱离和深冻结保证运行时不可变：`{ version, id, createdAt, cwd?, parentSession?, seedLength?, delegationDepth? }`。持久化 loader 可返回相同数据类型的可变脱离副本。该类型与 `SessionId` 一同归此包所有，因为 `Session.header` 以它为类型；持久化后端只是重新导出而不拥有它，否则会形成包循环依赖。

### 扩展点

- 持久化插件：订阅 `session/event`（延后写入），并在 `session/flush`（受等待）及 fiber dispose（资源释放）时排空。持久后端读取日志并重新加载到实时会话；这类后端会把元数据约定（`SessionHeader`、`session.header`）与日志一同存储。
- 回放／fork：`create(id, { seed })` 校验并冻结连续的当前格式日志，再重建 surface；请求头必须包含提供方／模型，assistant 消息必须包含提供方／模型溯源信息。持久化层在构造该当前格式 seed 前负责读取兼容性处理。`fork(source, boundary?, childSessionId?)` 选择已完成轮次前缀并记录谱系。
- 压缩：`dsh-compaction-basic` 为摘要检查点追加一个替换用 `user/message`，而 `dsh-compaction-tool-result-pruner` 追加仅修改内容的 `tool/result` 替换。工具配对边界策略及其缓存归 [`dsh-compaction` seam](../../compaction/compaction/README.md) 所有；此包拥有有序 surface 成员关系、替换校验与 `replaceGeneration`。

## 模型体验

### 派生消息历史

#### 模型看到的内容

模型会原样接收 `user/message`、`assistant/message` 和 `tool/result` surface 条目中的完整消息。其标识、角色、来源和内容块都与创建时确定的值相同；投影不会生成标识。提示词封装只改变面向人的呈现；其前缀上下文和请求分隔符已经位于事件内容中。工具调用包含在 assistant 消息内。分片、边界、用量、钩子记录、todo 记录以及其他仅日志事件不会添加消息。

#### Token 影响

追加的 surface 条目会在后续步骤中重新发送。`replace` surface 操作会从未来输入中移除被遮蔽条目，但不删除其原始日志记录。

#### KV Cache 影响

追加的 surface 条目会保留可复用前缀。即使底层事件日志保持仅追加，`replace` 操作也会从首条被遮蔽消息起使缓存复用失效。

### 崩溃修复结果

#### 模型看到的内容

如果恢复发现 assistant 工具请求没有持久 `tool/call`，其合成 `TOOL_NOT_STARTED` 结果内容为 `The tool call was interrupted before the Harness recorded it as started. Retry it if it is still needed.`。如果持久 `tool/call` 没有结果，其 `TOOL_OUTCOME_UNKNOWN` 结果内容为 `The tool call was interrupted after it was recorded, but no result was durably recorded. Its outcome is unknown. Decide whether to retry from the tool semantics: retry only if the operation is read-only or idempotent; if it may have side effects, first verify external state or ask the user. Do not retry blindly.`。

#### Token 影响

未受损会话的 token 增量为零。恢复时，每个修复后的调用都会添加保留的、针对具体风险的错误文本。

#### KV Cache 影响

保持仅追加；新可见内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

### 已记录的请求头

#### 模型看到的内容

会话会重建循环实际发送的系统提示词、工具 schema、调用配置和会话前缀。请求头事件不会向消息历史加入第二份副本；前缀在 `deriveMessages()` 外部前置。

#### Token 影响

日志记录不产生重复 token。重建的前缀、系统文本和 schema 仍会产生正常的逐请求开销。

#### KV Cache 影响

记录日志不会导致失效，精确重建会保持请求前缀一致。后续请求头若更改前缀、提示词或 schema，可能从第一处差异开始使复用失效。

## 已知限制与暂缓事项

- **会话分支／树结构**（pi 风格条目树）：除非需要超越基于边界的 `fork()` 能力，否则暂缓。
- **`fork()` 仅在实时会话的稳定边界处切分**：所选前缀结束时不得有开放轮次，且源会话必须位于存储中；[fork API](../../../.agents/notes/implemented/feature/2026-06-30-session-store-fork-api.md) 不支持对已持久化但未加载的会话进行 fork。
- **`SESSION_FORMAT_VERSION` 固定为 `0`**：预发布阶段不承诺广泛兼容性；`Session` 只接受当前 seed 形状，后端拒绝其他任何版本并说明方向（更新的版本提示"由更新的 harness 写入，请升级"；更旧的版本说明尚无升级路径）。不认识的事件类型同样被拒绝，除非信封带 `ignorable` 标记；版本机制见 [session-log 版本机制 Agent Note](../../../.agents/notes/implemented/architecture/2026-08-10-session-log-version-mechanism.md)。范围受限的存储导入升级应由持久化边界负责（[政策](../../../AGENTS.md)、[消息标识机制引入前的消息恢复](../../../.agents/notes/implemented/bug-fix/2026-07-28-load-pre-identity-session-messages.md)）。
- **`TurnEndReasonMap` 不含 ACP（Agent Client Protocol）命名的 `refusal`／`max_turn_requests` 变体**：受生产方约束；只有当适配器或循环首次产生这些变体时才加入。
