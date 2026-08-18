# @deepseek-ai/dsh-tool-ralph

[English](README.md) | 中文

面向模型的 `ralph` 工具运行固定的前台工作流，把一个不可变目标依次交给多个全新子 agent（智能体）。它展示如何把专用编排策略实现为基于 [`ctx.workflowEngine`](../workflow/README.md) 和 [`ctx.subagents`](../../subagent/subagent/README.md) 的普通插件：不会向 `agent-loop` 添加 Ralph 模式或全新 agent loop（智能体循环），同会话的[目标领域](../../goal/goal/README.md)也保持独立。策略和暂缓事项由 [Ralph Agent Note（agent 决策记录）](../../../.agents/notes/implemented/feature/2026-07-19-fresh-agent-ralph-workflow-tool.md)负责。

## 契约

`ralph({ objective, maxRounds? })` 会等待整个运行完成。部署配置中的 `maxRounds` 既是默认值，也是调用覆盖值的上限。每个 Ralph Round 通过 `subagentProvider` 启动一个子 agent；该提供方必须存在、支持结构化输出，并报告 `inheritsParentContext: false`。已配置的提供方以 `WorkflowStartRequest.subagentProvider` 传递，使固定脚本无法检查或更改路由，普通的模型编写 `workflow` 工具也不会因此获得提供方选择器。解析后的 Round 上限还会作为 `WorkflowStartRequest.maxTotalAgents` 传递，使固定循环与引擎的子 agent 总数后备上限协同；Ralph 上限超过引擎部署上限时，引擎会在发布运行前拒绝。

每个子 agent 只接收不可变目标、当前 Ralph Round 及其上限、一条「共享工作区是权威状态」指令，以及上一个结构化交接内容。工作区是长期记忆；不会把父级对话或先前子 agent 会话作为初始内容。报告包含 `status: continue | complete | blocked`、非空摘要、证据、后续步骤和阻塞文本。固定工作流内部及消费方边界都会校验特定状态的语义和序列化后的 `maxHandoffChars` 上限。无效、缺失或过大的报告会使工作流失败，而不会被截断或误认为上限耗尽。

成功的终态工具结果为 `complete`、`blocked` 或 `budget-limited`，并包含最后一份有界报告和已启动的 Round 数量。规范包络为 `{ runId, agentsStarted, result }`；Native 渲染器中的完成与阻塞标签会明确说明结果由 worker 报告，而非独立认证。`maxResultChars` 只限制包含截断标记的渲染文本，不会改变规范值中经过校验的报告或跨 Round 交接内容。

普通子 agent 失败会产生错误，其中标明失败的 Round；如果已有上一次成功交接，也会保留它。Ralph 不会重试该 Round。致命的提供方启动、传输、worker 或工作流失败仍是工作流错误，并可能在固定脚本返回交接内容前结算。取消同样属于错误；局部输出绝不会视为成功。

## 生命周期与取消

调用方 agent 是每个全新子 agent 的父级，因此会保留 cwd 和谱系，但不会复制其对话。`exec.signal` 进入工作流引擎，同时也桥接到 `run.cancel()`，以便不依赖具体实现。工具等待 `run.result` 并调用 `run.dispose()`，后一个调用位于 `finally` 中，因此取消的父级步骤会等到引擎完成有界终止且子 agent 完全停稳后才返回。

## 渲染意图

待处理调用使用 `generic` 卡片，标题为 `ralph`；不可变目标作为其 `rawInput`。结果继续使用 generic 卡片。两个呈现函数都只依赖工具参数和已结算的工具包络。

## 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `subagentProvider` | `spawn` | 每个 Round 使用的全新结构化输出提供方。 |
| `maxRounds` | `256` | 一次 Ralph 运行的默认值和部署上限。 |
| `maxHandoffChars` | `16384` | 一份 Round 报告序列化后的最大字符数。 |
| `maxResultChars` | `16384` | 返回给父级的完整成功结果最大字符数。 |

插件应用时会规范化并校验所有配置值，也包括绕过 Loader schema 规范化而直接应用的情况。每次调用前都会立即解析提供方能力，因为提供方注册可能随插件生命周期和热模块替换（HMR）变化。

## 模型体验

### 系统提示词

#### 模型看到的内容

在该插件的注册作用域内，每个父级请求都会收到下方的固定路由指导。

##### Ralph 指导

```markdown
Use the ralph tool ONLY when the direct human explicitly asks for a Ralph loop or fresh-agent iterative execution. Each Ralph round starts a fresh child with no conversation seed and uses the shared workspace as durable memory. Completion and blockers are worker reports, not independent evaluation. Use same-session goal tools for ordinary long-running objectives, and plain subagents or workflowEngine for bounded delegation and fan-out.
```

#### Token 影响

插件启用期间，每个请求都会产生少量固定的指导 token 开销。

#### KV Cache 影响

只要插件作用域和指导文本不变，前缀就保持稳定。启用或 dispose（资源释放）可能会使从该提示词段起的缓存复用失效。

### 工具 schema

#### 模型看到的内容

已生成的 [`ralph` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-ralph)公开一个必填 `objective` 字符串和一个可选 `maxRounds` 数字。提供方选择、交接大小、报告 schema、工作流脚本和编排行为均由部署侧控制，不在调用 schema 中。

#### Token 影响

工具可见时，每个请求都会产生少量固定的 schema token 开销。

#### KV Cache 影响

只要定义和可见性不变，前缀就保持稳定。

### 子 agent 请求与父级结果

#### 模型看到的内容

每个子 agent 都会看到独立的固定 Round 提示词和结构化输出捕获契约。父级只看到原始调用和一个终态结果，其中包含 worker 报告的状态、Round 数量及经过美化打印的最终报告；中间子 agent 消息和报告不会进入父级对话。普通子 agent 失败时会改为产生错误，其中包含对应 Round 编号；从第二个 Round 起，还会包含上一次成功交接。

#### Token 影响

每个 Round 都会支付全新子 agent 上下文的成本。`maxHandoffChars` 限制跨 Round 状态，`maxResultChars` 独立限制完整的父级成功文本；子 agent 工作留在父级上下文之外。

#### KV Cache 影响

每个全新子 agent 都有独立的请求缓存。父级结果追加在可复用请求前缀之后。

## 已知限制与暂缓事项

- **完成由 worker 自行声明**：没有独立的评估器或验证器判断目标是否实际完成；评估器策略及评估器驱动的延续均暂缓处理。
- **仅支持前台**：没有 job id、后台收集、进程恢复检查点、调度器或基于挂钟时间的启动策略。
- **工作区是唯一的跨 Round 长期记忆**：一份有界报告作为显式交接内容，每个子 agent 结束后，未提交的对话推理都会消失。
- **一个 Round 对应一个全新子 agent**：Round 内没有扇出、模型/提供方切换、fork 上下文或由模型调用选择的提供方。
- **普通子 agent 失败会终止运行**：固定脚本报告失败的 Round 和上一次成功交接，但不会重试；致命的工作流基础设施失败可能在该状态返回前结束。
- **聚合工作量仅受 Round 数量限制**：token、价格和耗时预算均暂缓处理。
