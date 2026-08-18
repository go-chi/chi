# @deepseek-ai/dsh-subagent-in-process-driver

[English](README.md) | 中文

本包是两个进程内提供方共用的运行驱动器。spawn 不传入会话初始内容；fork 传入父 agent（智能体）已完成轮次的前缀。其余机制，包括深度、子 agent 创建、可选的子 agent 定制、结果读取、取消和 dispose（资源释放），都在此共用同一套实现。

## 启动约定

`startInProcessRun(request, options): Promise<SubagentRun>` 只在子 agent 发布到 `ctx.agents` 后才兑现。启动被拒绝时，agent 工厂的未发布创建事务已经完全停稳，因此调用方绝不会收到创建到一半的句柄。

驱动器按以下顺序运行：

1. 校验父 agent 深度和可选的绝对 `maxDepth`，然后把子 agent 深度推导为父 agent 深度加一，并将其持久化到子 agent 会话 header。
2. 直接调用 `parent.ctx.agents.create`，把必需的请求信号传入工厂的创建事务。
3. 在该事务未发布的设置窗口中，安装请求的 persona、工具限制和结构化输出运行时。
4. 发布子 agent，保留返回的 `AgentHandle`，并通过先调用 `child.followup(prompt)`、再调用 `child.whenIdle()` 来驱动一项任务。
5. 从完整的自有子运行中读取子 agent 自身的输出——最后一条非空 assistant 消息（记录 usage 的空内容消息会被跳过），若没有这类消息则取其累积的 assistant 文本——以及最终持久化的轮次原因，并排除任何 fork 初始内容。

子 agent 会获得父 agent 的工作目录／会话谱系；除非 `request.agentOptions` 覆盖，否则还会继承父 agent 的提供方、模型和输出 token 上限。它获得全新的扁平注册作用域：父级所有权不会导入父 agent 的工具限制，也不会建立权限子集。

该结果边界成立，是因为提供方拥有从发布到完全停稳的隔离子 agent 生命周期。在该生命周期内提交的 steering（中途引导）属于子运行；提供方不会声称输出只归初始 follow-up 所有。

驱动器通过共享的子 agent 辅助函数应用该 seam 的[委派策略](../subagent/README.md#delegated-policy)：它会在创建子 agent 前捕获父级的显式沙箱覆盖项与 `'never'` 审批钉定，并在未发布的设置阶段追加带来源标记的事件，使其位于所有 fork 历史之后、会话发布之前。参见[委派策略决策](../../../.agents/notes/implemented/feature/2026-07-25-subagent-policy-inheritance.md)。

## 取消与所有权

必需的请求信号同时覆盖启动阶段和实时运行。发布前，`AgentCreationTransaction` 会观察该信号、回滚并拒绝。工厂返回前会移除仅用于创建阶段的监听器；驱动器随即再次检查信号，然后安装最小化的实时运行监听器，从而消除交接竞态。发布后，中止会取消子 agent。

兑现后，调用方拥有该运行。提供方插件卸载不会撤销它。`dispose()` 会移除实时中止监听器、记录取消，并委托给返回的 `AgentHandle.dispose()`；后者通过经记忆化的完全停稳事务停止循环、移除 agent 和会话，并撤销作用域内的注册。取消流程会接管所有尚未完成的进行中结果，并将其报告为 `aborted`；已经完成的轮次仍保持完成状态。

## spawn 与 fork 输入

`InProcessRunOptions` 的形态为 `{ seed?: SessionEvent[] }`。spawn 省略该值。fork 提供已配平的已完成轮次前缀，并记录其长度，确保结果读取器不会把作为初始内容的父 agent 消息误认为子 agent 输出。

深度强制在 `startInProcessRun` 内部完成：它通过 `delegationDepthOf` 读取父 agent 深度（持久化的 `SessionHeader.delegationDepth` 具有权威性；运行时 `AgentOptions.subagentDepth` 可以加深但绝不能降低该值，因此恢复后的子 agent 会保留预算），缺失值按顶层深度零处理，拒绝格式错误的存储值，并报告尝试的子 agent 深度超过 `maxDepth`。超过安全整数范围、无法表示的深度会触发 `RangeError`。子 agent 深度写入子 agent header，因此会在持久化和恢复后保留。

## 结构化输出

`attachStructuredRuntime(childCtx, schema)` 会在子 agent 作用域中安装完整约定：

- 使用请求 schema 注册的 `structured_output` 工具会校验并暂存模型值。
- 一个顺序为 190 的系统提示词段会告诉子 agent，该工具调用就是终态答案。
- 两项贡献都是普通的子 agent 作用域注册。专家级 `system-prompt/assemble` 监听器可以替换它们，因此负责为该子 agent 保留结构化输出协议。
- `tools/result` 观察器只会在该次执行的权威最终工具结果成功后提交暂存值；Code Mode 子分派外层的 `run_code` 结果也包括在内。
- 单调工具防护会在捕获值后阻止后续调用，结构化输出执行的 `concludeTurn()` 标记则在结果提交后结束轮次。

正常结束却始终未提交必需结构化值的轮次会报告 `error`；驱动器不会重新提示。所有注册都附着于子 agent fiber，并随其一同消失。

## 模型体验

### 子 agent 请求

#### 模型看到的内容

共享驱动器把任务逐字作为子 agent 的用户消息发送；若有请求，还会在未发布子 agent 的全新作用域中遮蔽 persona，并限制全局工具 schema、查找、执行和 Code Mode SDK 绑定。父 agent 的限制不会被继承，独立的工具指导段仍会保留。spawn 不提供历史；fork 提供平衡的初始内容。

#### Token 影响

子 agent 输入与父 agent 隔离，并通过子 agent 自身的步骤增长。persona 会改变重复提示词文本；过滤会改变 schema 或生成 SDK 的成本，但不影响独立注册的指导内容。

#### KV Cache 影响

与父 agent 请求缓存相互独立。子 agent 后续历史仅追加，而 persona、工具过滤、生成 SDK、提供方或模型变化会建立不同的子 agent 前缀。

### 结构化输出系统提示词、schema 与结果

#### 模型看到的内容

结构化运行会添加下方的结构化输出指令。它还会添加子 agent 作用域的 `structured_output` 定义，其精确描述为 `Report your final structured result. Call this exactly once, when your answer is complete; the arguments must match this tool's parameter schema exactly.`，参数使用请求的 schema。该仅运行时存在的定义不在已生成并随产品发布的[工具包索引](../../../docs/tool-catalog.md#tool-package-map)中。其规范确认值是 `{ recorded: true }`，渲染为 `Structured output recorded.`；后续调用会变为 ``Error: structured output already recorded: the run is complete, so `<tool>` is not executed``。

##### 结构化输出指令

```markdown
When you have your final answer, you MUST report it by calling the `structured_output` tool with arguments matching its parameter schema exactly. Do not finish with a plain text answer: only the tool call counts as your result.
```

#### Token 影响

固定指令和能力产生的 token 开销仅由该子 agent 承担。结果文本进入子 agent 历史，而只有捕获的值会成为父 agent 结果。

#### KV Cache 影响

只要结构化输出指令和 schema 不变，子 agent 内部的前缀就保持稳定。更改 schema 或能力可能从该早期片段开始使子 agent 缓存失效；结果会分别追加到子 agent 和父 agent 历史中。

### 父 agent 启动错误（间接）

#### 模型看到的内容

通过 `dsh-tool-subagent`，无效深度状态会精确变为 `Error: agent subagentDepth must be a non-negative safe integer`、`Error: subagent child depth exceeds the safe-integer range` 或 `Error: subagent depth <attempted> exceeds maxDepth <max>`。发布前取消的中止原因会通过注册表的 `Error: <message>` 包装传递。

#### Token 影响

启动成功时为零 token；只有失败的父 agent 工具调用会保留这段文本。

#### KV Cache 影响

仅追加；新增可见内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

### 父 agent 结果（间接）

#### 模型看到的内容

驱动器只提取子 agent 自身最后的 assistant 输出或捕获的结构化值；作为初始内容的父 agent 消息和子 agent 中间工作不会成为结果。

#### Token 影响

父 agent 通过消费方接收一个依赖数据的结果；其他所有子 agent token 都留在子 agent 会话中。

#### KV Cache 影响

仅追加；新增可见内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

## 已知限制与暂缓事项

- **运行不公开 `sendMessage`/`resume`**：进程内运行不具备这些可选运行时能力。
- **结构化捕获只接受 `defineTool` schema 子集**：不支持的 JSON Schema 构造会在子 agent 创建前失败；需要更广 schema 词汇的提供方必须采用不同的运行时。
