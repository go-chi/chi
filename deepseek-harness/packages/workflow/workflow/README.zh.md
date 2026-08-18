# @deepseek-ai/dsh-workflow

[English](README.md) | 中文

工作流 seam（扩展点，`ctx.workflowEngine`）执行由模型编写、可扇出 subagent 的编排脚本。该 seam 定义脚本、运行、结果、错误和事件契约；引擎负责决定如何隔离并执行脚本。

`@deepseek-ai/dsh-workflow-worker-thread` 是当前引擎，`@deepseek-ai/dsh-tool-workflow` 是面向模型的消费方。未来的进程或沙箱引擎可以替换实现，而无需更改工具。

包根是 Host face。浏览器安全的 `@deepseek-ai/dsh-workflow/types` 子路径包含运行身份、元数据、结果和仅供观察的生命周期 payload，不导入 `Agent`、Cordis service 或 Host Context 声明；Host 专用的 `WorkflowStartRequest` 与 `WorkflowRun` 只从包根提供。

## 服务与运行契约

`WorkflowEngine.start(request): WorkflowRun` 会同步完成足够多的校验，在运行创建前拒绝格式错误的 meta 块、无法解析的脚本、不可用的提供方路由或不受支持的单次运行限制。返回后，`WorkflowRun.result` 绝不拒绝：执行失败以 `stopReason: 'error'` 兑现，取消则在引擎有限的宽限时间内以 `cancelled` 兑现。

运行由持有方负责。引擎插件卸载会阻止新的启动，但不会撤销已接受的运行。持有方必须在每条路径上调用 `dispose()`；dispose（资源释放）会取消剩余工作，并在文档规定的期限内达到或放弃完全停稳。

`WorkflowStartRequest` 包含 `{ meta, script, args?, subagentProvider?, maxTotalAgents?, parent, signal? }`。`parent` 把每个子 agent（智能体）归属于调用 agent。`subagentProvider` 可以为该次运行的所有子 agent 指定路由，同时不向脚本公开提供方选择；省略时使用引擎配置的提供方。`maxTotalAgents` 可以为一次运行降低引擎的部署上限，同样对脚本不可见。实现会同步拒绝无效路由和限制。`meta` 与 `args` 是普通数据，不是脚本片段。

`WorkflowRun` 公开 `{ id, meta, result, cancel(reason?), dispose() }`。`WorkflowResult` 包含 `{ value, stopReason, error?, agentsStarted }`；`value` 是普通 JSON 数据或 `null`。

## 事件

工作流事件只供观察。它们携带 `WorkflowRunInfo`（`id` 加 `meta`），而不是活动运行，因此监听器无法取得取消或 dispose 权限。

- `workflow/start` / `workflow/end` 为运行配对；
- `workflow/phase` 和 `workflow/log` 公开脚本叙述；
- `workflow/agent-start` / `workflow/agent-end` 按 `seq` 为每次子 agent 调用配对；提供方的异步启动调用被拒绝时，该子 agent 不会发出其中任何一个事件。

同进程事件 payload 是以不可变方式借用的值。每个监听器都独立隔离：同步抛出异常或返回的 promise 被拒绝时，只会记录日志，不会阻塞同级监听器或改变执行。

## 失败纪律

`WorkflowError` 携带一个代码和 `fatal` 标志。致命错误总会逸出 `parallel()` 和 `pipeline()`，而不会变成普通的逐项 `null`：

- `SCRIPT_PARSE` / `META_INVALID`：工作流无法启动；
- `INVALID_ARGUMENT` / `UNSUPPORTED_OPTION` / `UNSUPPORTED_SCHEMA`：钩子调用违反引擎契约；
- `AGENT_CAP` / `ITEM_CAP`：超过已配置的安全上限；
- `AGENT_START`：提供方的异步启动调用被拒绝；
- `AGENT_RESULT`：已发布子 agent 的结果因基础设施故障而被拒绝；
- `RESULT_UNSERIALIZABLE`：脚本/worker 值不是普通 JSON 数据；
- `CANCELLED`：取消会接管该运行，待处理和未来的钩子都会拒绝。

子 agent 若以非完成的结束原因正常兑现，并不属于基础设施异常：`agent()` 返回 `null`，使脚本可以处理普通的子 agent 失败。

## 模型体验

通过 `dsh-tool-workflow` 和工作流引擎间接产生影响；两者创建子 agent 请求，并返回保留在父级的工具结果。

#### KV Cache 影响

不会直接导致 KV Cache 失效；请求前缀的任何变化均由上述消费方负责。

## 已知限制与暂缓事项

- **仅支持前台收集**：调用方负责一个活动运行并等待它；后台启动／轮询、spill 句柄和分离收集均暂缓处理。
- **没有日志化或恢复**：脚本、子 agent 进度和中间值均不设检查点，因此进程重启后无法继续运行。
- **没有已保存或嵌套工作流**：该 seam 只启动调用方提供的脚本，工作流脚本不会收到用于递归编排的 `workflow()` 钩子。
- **没有 token 预算词汇**：引擎会限制并发、条目和子 agent，但请求与结果都不会统计跨子 agent 的模型 token。
- **运行由持有方负责，不由服务跟踪**：卸载引擎不会发现独立的活动句柄；每个消费方都必须 dispose 自己启动的运行。

暂缓实现的工作流接口见[动态工作流 Agent Note（agent 决策记录）](../../../.agents/notes/implemented/feature/2026-07-05-dynamic-workflows.md)。
