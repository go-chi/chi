# @deepseek-ai/dsh-tool-subagent

[English](README.md) | 中文

基于一个已配置 `ctx.subagents` 提供方、面向模型的委派工具。更换提供方只会改变传输，不会改变执行约定。

## 提供方选择与生命周期

每个插件实例把一个 `provider` 绑定到一个 `toolName`；模型不会收到提供方选择器。如需公开另一种传输，请加载另一个名称不同的实例。工具只在其提供方存在时注册，从而避免对同级加载顺序和提供方重新加载的依赖。工具描述遵循 `provider.inheritsParentContext`：新建子 agent（智能体）需要独立提示词，而 fork 子 agent 已能看到父级已完成轮次。

前台调用会让执行信号贯穿启动和执行，等待 `run.result`，并且在返回前总会等待 `run.dispose()`。只有 `completed` 会返回规范值 `{ kind: 'foreground', runId, output: JsonValue[] }`，并渲染为相同的最终文本；中止、拒绝、token 上限和其他失败都会变成出错的工具结果，其消息在终止原因标题之后附带子 agent 保留下来的部分文本（即 `SubagentResult.output` 的选取结果）——被截断的回答不会被报告为成功，也绝不会被悄悄丢弃。如果结果收集与 dispose（资源释放）都 reject，出错的结果会保留两项诊断信息。

`backgroundMode` 同时选择后台路由与省略 `run_in_background` 时的默认行为。`one-shot` 默认在前台等待；显式传入 `true` 时，它会注册一个归父级所有的普通 Task，并返回规范值 `{ kind: 'background', jobId }`，渲染为 `started background subagent job <id>`，即使提供方支持可继续子 agent 也不例外。通用 Task 工具负责其后续状态、收集、取消和通知。`continuable` 在参数省略或为 `true` 时于后台运行；显式传入 `false` 时则在前台等待结果。其后台路由要求提供方具备 `prepareContinuable` 能力，调用 `ctx.subagents.startContinuable()`，并返回 `{ kind: 'continuable', subagentId }`，渲染为 `started subagent <childId>`。该路由在 inbox 接受时结算：子 agent 自此拥有自己的轮次，因此该调用既不等待也不收集结果。通过该 id 查看其 transcript（文本记录）仍是其详细输出的来源，可选的全局 `send_message` 工具则向其发送更多工作。每当子 agent 的 Activation 结束，继续执行服务都会投递一条结算通知，其中包含结束结果及可能存在的最终 assistant 消息，且这项投递不依赖 `report`。启动可继续工作不要求加载 `send_message`。见[后台 subagent Agent Note](../../../.agents/notes/implemented/feature/2026-07-08-background-subagent-tasks.md)、[可继续的 subagent Agent Note](../../../.agents/notes/implemented/feature/2026-07-28-continuable-subagent-conversations.md)和[后台优先委派 Agent Note](../../../.agents/notes/implemented/feature/2026-08-11-background-first-continuable-delegation.md)。

`toolFilter` 会改变子 agent 的全局工具层，但不是从父级派生的权限上限。见 [agent 作用域的安全非目标](../../../.agents/notes/implemented/architecture/2026-07-08-agent-scope-contexts.md#security-and-authority-are-non-goals)。

## 配置

| 键 | 含义 |
|---|---|
| `provider`（必填） | 提供方名称（`spawn`、`fork`、`acp` 等）。 |
| `toolName` | 面向模型的名称，默认 `subagent`；每个已加载实例必须不同。 |
| `enableRunInBackground` | 公开后台模式，默认 `true`；禁用时也会拒绝强制后台调用。 |
| `backgroundMode` | 后台生命周期策略，默认 `one-shot`。`one-shot` 默认前台调用；`continuable` 默认后台调用，要求提供方具备 `prepareContinuable` 能力，并返回持久化子 agent ID，且不要求加载后续消息工具。 |
| `agentOptions` | 传给具体提供方的子 agent `provider`、`model` 和正整数 `maxTokens`；进程内提供方会用显式值覆盖继承的父级选项。 |
| `persona` | 每个子 agent 独立的 persona；要求提供方具备 `persona` 能力。 |
| `toolFilter` | 每个子 agent 独立的全局工具限制；要求提供方具备 `toolFilter` 能力。 |
| `maxDepth` | 绝对委派深度上限，默认 `3`（`0` 禁止委派）；数值上限要求 `depthLimit` 能力，缺失时挂载失败。对于预算由子 harness 拥有的进程外提供方，`'provider-managed'` 不发送上限。工具在达到上限时仍然可见；每次尝试启动都会检查调用 agent 的当前深度，被拒绝时返回出错的工具结果。 |

## 并发

前台调用和后台调用均并发安全：同一条 assistant 消息中的同级委派会在循环的滚动池（`maxParallelToolCalls`）下重叠执行，结果仍按模型顺序提交。子 agent 在各自的会话中工作，一次运行绝不变更父会话；一次性后台形态对父级拥有状态的唯一写入是注册一个 Task——这是一次同步、可交换、能容忍并发分发的插入，因此重叠的后台调用按分发竞态顺序获得各自的 job id。协调同级工作区效果由模型负责，正如模型已经对后台和可继续子 agent 所承担的那样。见 [并行 subagent Agent Note](../../../.agents/notes/implemented/feature/2026-08-09-parallel-subagent-delegations.md) 和 [并行工具调用 Agent Note](../../../.agents/notes/implemented/feature/2026-07-10-parallel-tool-call-execution.md)。

## 模型体验

### 工具 schema

#### 模型看到的内容

当提供方存在时，以当前实例配置的名称公开已生成的默认 [`subagent` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-subagent)。提供方是否继承上下文会改变工具描述和提示词描述。启用后台模式会添加 `run_in_background`：可继续模式会记录其默认值为 `true`、运行时结算通知与显式前台覆盖；一次性模式会记录其默认值为 `false`，以及用 `job_output` 收集或用 `job_kill` 停止的 job id。当工具在本次组装的作用域中可见时，一个 `tool:<toolName>` 系统提示词 section 会指示模型同时启动相互独立的可继续委派、在它们运行时继续工作，并且仅当下一步动作依赖结果时选择前台；工具限制会同时移除其 schema 和这段指引。

#### Token 影响

每个父级请求都会产生固定的 schema token 开销；每个提供方实例增加一个 schema，每个可继续实例还会增加一个简短的系统提示词 section。

#### KV Cache 影响

只要提供方实例、名称、描述和 schema 不变，前缀就保持稳定。提供方注册生命周期可能从首个变化的工具定义开始，使父级复用失效。

### 前台结果

#### 模型看到的内容

调用会保留描述和提示词。成功时只包含子 agent 的最终文本；其他结果变为 `Error: <message>`。子 agent 中间步骤不会进入父级。

#### Token 影响

提示词和结果会留在父级历史中，直到上下文压缩（context compaction）；子 agent 工作上下文留在子 agent 中。

#### KV Cache 影响

仅追加；新增可见内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

### 后台结果

#### 模型看到的内容

在配置的可继续模式下，启动时返回内容恰为 `started subagent <childId>`；在配置的一次性模式下，则返回 `started background subagent job <id>`。一次性模式下，通用 Task 接口提供后续状态、最终输出、取消响应和通知。可继续模式下，本工具不返回自己的结果；子 agent 的结算会以[服务负责的通知](../subagent/README.md#settlement-notice)到达父级，独立加载的 `send_message` 工具会投递后续消息，而通过其 id 查看子 agent 的 transcript 即是其详细输出来源。

#### Token 影响

确认消息会被保留；一次性最终输出只在收集或注入时进入父级历史，而可继续子 agent 的输出绝不会通过本工具返回——其结算通知独立于任何工具结果到达。

#### KV Cache 影响

仅追加；新增可见内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

## 已知限制与暂缓事项

- **后台运行不通过本工具公开结果**：一次性任务的最终输出通过通用 Task 接口收集，可继续子 agent 的输出留在其自身会话中，按其 subagent id 读取。结算通知会说明该子 agent 如何结束，并携带可能存在的最终 assistant 消息，但它不是本次调用的返回值，也无法在此等待。
- **等待中的一次性实例较晚才发现重复名称**（`TODO(subagent-dup-toolname)`）：可继续实例会在插件应用期间预留提示词 section 名称，但若要阻止等待中的一次性实例回滚提供方注册，仍需要一份预期名称注册表。
- **每个实例的子 agent 策略固定**：其他模型、persona、工具过滤器或深度上限都需要另一个名称不同的工具。
