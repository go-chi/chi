# @deepseek-ai/dsh-tool-workflow

[English](README.md) | 中文

面向模型的 **`workflow` 工具**：运行一段扇出 subagent 的 JavaScript 编排脚本，并返回脚本的最终值。本包负责基于 [`ctx.workflowEngine`](../workflow/README.md) 定义面向模型的 schema 和运行生命周期；脚本解析、执行、上限与取消位于 seam 之后，消费方仍负责面向父级的 schema 和结果包络。

## 模型看到的内容

工具有三个参数：`meta`（必需的身份数据：`name`、`description` 和可选的进度注解）、`script`（必需的纯 JavaScript 脚本体，不含 `export const meta` 语句；工具描述包含完整的编写约定）以及 `args`（可选 JSON 对象，作为全局变量 `args` 向脚本公开；裸列表应包装到字段中，使协议 schema 如实表达形态）。插件还会贡献一个 `tool:<toolName>` 系统提示词段，其中包含使用策略：只有用户明确要求工作流／大型编排时才使用该工具；一两项委派优先使用普通 subagent 调用。这遵循工具指导随工具插件交付、绝不放入部署 persona 的约定。

## 生命周期

收集是同步的（类似 [`dsh-tool-subagent`](../../subagent/tool-subagent/README.md)）：`execute` 启动运行并等待 `run.result`；这些操作位于 `try/finally` 中，该结构总会 dispose（资源释放）运行，使脚本及其子 agent（智能体）在每条路径上完全停稳。`exec.signal` 会桥接到 `run.cancel()`，包括启动前已经中止的情况。非 `completed` 结束原因会映射为报告原因的 `isError` 结果，绝不会把局部输出当作成功；`start()` 同步抛出的解析／meta 失败会变成模型可据以修正的 `isError`。完成时返回规范值 `{ runId, agentsStarted, result }`；Native 渲染器保留 meta 名称、agent 数量和 JSON 值，只会在 `maxResultChars` 处截断该投影。

对于根 transport 执行（`exec.parent` 缺省），工具还会把运行投影到调用 Agent 的 Session：`start()` 返回后写 run-start，只记录 `run.id` 匹配的成员开始与结束，并且只在 `run.result` 已取得且 `dispose()` 完全停稳后写 run-end。嵌套 transport 调用照常执行，但不写工作流记录。任一次 Session append 首次失败后，本运行会停止后续记录并只告警一次，留下空记录或合法连续前缀，同时不改变工具结果和清理。

浏览器安全的 `@deepseek-ai/dsh-tool-workflow/types` 子路径拥有这四类 log-only 事件 payload 及其 `SessionEventMap` 声明。包 invariant 会在冷加载和实时追加时拒绝重复 start、未配对成员、仍有开放成员的终点和 run-end 后更新，同时允许缺失终态后缀的连续前缀。

## 渲染意图

渲染意图预先确定（见[渲染意图 Agent Note](../../../.agents/notes/implemented/architecture/2026-07-02-tool-render-intent-union.md)）：使用一个 `generic` 卡片，标题为 `workflow: <meta.name>`，直接从 `args.meta.name` 读取（呈现是参数的纯函数，不要求引擎解析）；脚本文本作为 `rawInput` 携带。结果继续使用 generic 卡片。

## 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `toolName` | `workflow` | 要注册的面向模型工具名称。 |
| `maxResultChars` | `50000` | 渲染结果上限；更长的 JSON 会被截断并附上提示。 |

## 模型体验

### 系统提示词

#### 模型看到的内容

在该插件的注册作用域内，每个父级请求都会收到下方的工作流指导。作用域工具限制可以隐藏 schema，而不移除这段独立注册的指导。

##### 工作流指导

```markdown
Use the <toolName> tool ONLY when the user explicitly asks for a workflow or for large multi-agent orchestration: you write a JavaScript script (the tool description documents the exact format) that fans work out across many subagents with phases and structured results. For one or two delegations, prefer plain subagent calls.
```

#### Token 影响

插件启用期间，每个请求都会产生少量固定的指导 token 开销。

#### KV Cache 影响

只要插件作用域和指导文本不变，前缀就保持稳定。启用或 dispose 可能会使从该提示词段起的缓存复用失效。

### 工具 schema

#### 模型看到的内容

工具可见时，已生成的默认 [`workflow` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-workflow) 包含完整的 JavaScript 钩子与元数据约定；`toolName` 可以重命名该定义，模型会提交脚本、元数据和可选 args。

#### Token 影响

工具可见时，每个请求都会产生较大的固定 schema token 开销。

#### KV Cache 影响

只要 `toolName`、定义和可见性不变，前缀就保持稳定。重命名、插件生命周期或作用域限制可能会使从该 schema 起的缓存复用失效。

### 工具调用历史与结果

#### 模型看到的内容

由模型编写的完整脚本、元数据和 args 会保留在 assistant 工具调用中。成功结果精确为 `workflow "<name>" completed (<count> agent<optional-s>).`、换行、`Return value:`、换行，以及经过美化打印且依赖数据的 JSON；达到上限时，会在新行添加 `… [truncated: <omitted> more characters]`。失败结果精确为 `Error: workflow run was cancelled`（可以追加后缀 ` (<error>)`）、`Error: workflow run failed: <error-or-unknown error>` 或防御性的 `Error: workflow run ended abnormally (<reason>)`；没有所属 agent 的调用变为 `Error: workflow tool requires a calling agent (exec.agent was undefined)`。中间子 agent 消息会被省略。

#### Token 影响

调用 token 可能很多，并会保留到压缩（compaction）为止。结果渲染受 `maxResultChars` 限制；子模型 token 与父级保留的上下文相互独立。

#### KV Cache 影响

仅追加；新增可见内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

## 已知限制与暂缓事项

- **父级轮次会阻塞到整个工作流结算**：没有后台启动／轮询接口，取消会丢弃局部输出并返回错误。
- **`args` 必须是对象，Native 结果文本有界**：调用方把顶层数组／标量包装到字段中；规范工作流结果保持完整，超过 `maxResultChars` 的 JSON 会在面向模型的投影中截断，而不是存储在检索句柄背后。
- **每次工具注册的工作流策略固定**：提供方选择、上限和工具名称属于部署配置，不是模型调用参数。
- **持久记录只覆盖顶层且只供观察**：嵌套 Code Mode dispatch 不记录；记录故障会刻意退化为不完整前缀，而不改变执行。
