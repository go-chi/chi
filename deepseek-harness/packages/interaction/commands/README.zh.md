# @deepseek-ai/dsh-commands

[English](README.md) | 中文

由插件负责、供交互式 UI 适配器使用的面向用户命令注册表。[插件命令注册 Agent Note](../../../.agents/notes/implemented/feature/2026-07-19-plugin-command-registration.md)定义了其边界与分发约定。

## 服务约定

`ctx.commands.register(definition)` 注册一个小写命令名称、描述、可选的非结构化输入提示、可选的 `recordInput` 策略，以及可中止的处理器。`recordInput` 默认为 true；若载荷由命令的权威领域事件持有，该命令会将 `recordInput` 设为 false，让 `command/run` 省略 `args`，避免重复记录输入。每个已注册命令都可供所有已组合的命令适配器使用；与某项部署不兼容的插件不会在此注册。普通上下文中的注册全局生效。在 `agent.ctx` 下挂载的命令生产插件会声明自身的 `commands` 注入，并创建精确限定到该 agent（智能体）的定义；该定义会遮蔽同名的全局定义。这种子级注入形态保留了 agent 作用域，同时不会让核心 agent loop（智能体循环）依赖 UI 服务。同一层中的名称重复会在注册时失败。每个 disposer 都是 Cordis effect 返回的确切 disposer；注册或移除命令时，系统会通知每个 `commands/change` 观察者，使运行中的适配器能够刷新发现结果。观察者失败会写入日志，既不能否决注册表变更，也不能阻止后续观察者运行。

`list(agent)` 在应用作用域遮蔽后，返回按名称排序的不可变描述符。`find(agent, name)` 返回相应定义。`execute(agent, line, signal)` 使用 `parseCommand()`，且只运行已知命令，返回已结算的 `CommandExecution`（规范化结果加生命周期配对 `commandId`）；语法无效或名称未知时返回 `undefined`。已解析命令的生命周期会以 log-only 事件对的形式记录在接收 agent 的会话日志中：`command/run`（进入处理器前记录，携带新生成的 `commandId`、解析器的结构化名称、发起方 `CommandSource`，以及 `args`（`recordInput` 为 false 时省略））与 `command/done`（结算时记录，携带结果类型与原样文本；成功结果还可通过 `sourceEventSeq` 指向更早的一条非命令权威领域事件；处理器抛出或被中止时以 `kind: 'error'` 结算）。未通过准入的输入不记录任何事件。两者都直接独立追加到接收 agent 的会话中：没有轮次包裹它们，持久化机制会在常规检查点和销毁期间排空这些事件。

`parseCommand()` 识别位于第 0 字节的斜杠、由小写字母、数字、`_` 或 `-` 构成的名称，以及名称后紧接输入末尾或空白的形式。它将名称后的每个字节作为 `rawInput` 返回，其中包括分隔空白；消费方负责各命令专用的语法，只能执行该语法允许的规范化。

处理器返回 `success` 或 `error`，并可附带 UI 文本。若更丰富的呈现由一条更早的领域事件持有，成功的处理器还可返回 `sourceEventSeq`；生命周期不变量要求该引用指向同一会话中更早的一条非命令事件。适配器直接渲染结果，结果绝不进入模型历史。注册表绝不会隐式地把 `rawInput` 提交给 agent；命令生产方可以通过接收命令的 `Agent` 显式安排模型可见工作，此时该生产方负责由此产生的消息约定。注册表会同时等待处理器完成和所提供的中止信号，以先发生者为准，但不响应中止的处理器可能在调用方停止等待后继续产生自身的外部副作用。

## 组合

随产品交付的 `dsh` 基础组合会挂载此服务，Web 客户端通过它分派命令。无 UI 的演示主干和 ACP（Agent Client Protocol）自动化不提供命令适配器。自定义交互式组合与命令生产方会显式挂载 `@deepseek-ai/dsh-commands`。

## 模型体验

### 直接面向用户的命令

#### 模型看到的内容

注册表自身不会提交任何内容。已知斜杠命令在 UI 命令平面执行，其 `CommandResult` 文本不会作为用户消息提交。已交付的适配器会拒绝未知斜杠命令输入，而不是将其变成模型提示词。命令生产方可以显式使用接收命令的 `Agent`；例如，[`dsh-plan-mode`](../../plan/plan-mode/README.md#model-and-human-interactions)在选择 plan mode 后，会提交 `/plan [message]` 中的可选消息。

#### Token 影响

命令发现、执行和 UI 输出不会增加模型 token。命令生产方显式安排的 agent 工作与相应 agent 输入具有相同的 token 影响。

#### KV Cache 影响

注册表元数据、命令输入和直接输出绝不会进入模型请求，也不会影响其缓存。发生变更的领域负责之后产生的所有缓存影响。

## 已知限制与暂缓事项

- **仅支持非结构化文本输入**：表单、补全 schema 和类型化参数仍由各命令自行解析。
- **副作用采用协作式取消**：中止后，分发会停止等待；处理器必须遵循信号，才能停止已经进入外部系统的工作。
