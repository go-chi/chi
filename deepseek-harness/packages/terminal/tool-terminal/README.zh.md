# @deepseek-ai/dsh-tool-terminal

[English](README.md) | 中文

基于 `ctx.terminals` 提供 6 个面向模型的工具：`terminal_open`、`terminal_send`、`terminal_read`、`terminal_signal`、`terminal_close` 和 `terminal_list`。每项操作都要求提供完全相同的发起 `Agent`，因此即使模型获知另一个 agent（智能体）的 id，也无法操作其终端。

`terminal_send(run_in_background: true)` 会复用 `ctx.jobs`；任务预检和 PTY 服务对每个会话的独占发送预留都发生在返回 job id 之前。系统通过 `job_output` 收集完成结果，`job_kill` 则向前台进程组发送 `SIGINT`。前台发送使用终端调用／结果卡片。后台发送使用通用执行卡片；打开、读取、发送信号、关闭和列出操作则分别使用通用 `execute`、`read`、`execute`、`delete` 和 `read` 卡片。所有操作都不声明源位置。

## 配置

| 键 | 默认值 | 含义 |
|---|---:|---|
| `enableRunInBackground` | `true` | 公开并接受 `run_in_background`；设为 false 时，schema 会省略该字段，并拒绝强行传入未声明的参数 |
| `maxResultBytes` | `262144` | 每个完整终端结果或 PTY 任务输出的 UTF-8 上限（最小值 `64`）；在等待、会话、分页、截断和任务状态元数据全部加入后计算 |

两个值都会在加载时验证。最小结果上限可保证注册表签发的每个会话或 job id 都能出现在创建确认中。结果超过 `maxResultBytes` 时，只要空间允许，渲染会为控制元数据和截断标记预留空间；截断会保留 UTF-8 边界。每个终端定义的最终内容回调都会应用同一个上限，涵盖经过规范化的 pre-execute、around-execute 与 post-execute 策略失败、拒绝、短路、替换或阻止；结构化的多块策略结果保留其结构。

## 模型体验

### 系统提示词

#### 模型看到的内容

该插件贡献以下固定指引章节：

##### 终端指引

```markdown
Use a terminal session only when work needs persistent terminal state or interactive stdin; prefer shell/read/write/edit for bounded one-shot operations. Track every terminal session id and close sessions that no longer matter. An inferred_idle or timeout result does not prove the foreground command exited.
```

#### Token 影响

插件活跃期间，每次请求都会产生少量固定输入成本。

#### KV Cache 影响

注册范围和指引文本不变时，前缀保持稳定。

### 工具 schema

#### 模型看到的内容

6 个生成的 schema 列在 [`dsh-tool-terminal` 目录章节](../../../docs/tool-catalog.md#deepseek-aidsh-tool-terminal)中。此插件活跃时，请求中会包含它们的固定 schema token；按 agent 范围过滤工具时可能隐藏这些 schema。

#### Token 影响

工具可见的请求会产生固定的 schema 成本。

#### KV Cache 影响

工具可见性与定义不变时，前缀保持稳定。

### 工具结果与任务上下文

#### 模型看到的内容

spawn 会返回 id 和有界 MOTD。发送／读取会返回有界终端文本以及就绪／历史标记。后台模式返回通用 job id。所有终端自身或策略产生的单文本结果，在经过规范化的工具或流水线错误、拒绝、短路、替换、阻止与通用任务状态文本之后，都受 `maxResultBytes` 限制。结构化的多块策略结果保留其结构。结果会保留在会话历史中直到压缩（compaction）；增量任务读取不会重复已经消费的输出。编程调用方会收到带类型的会话快照、有界的提供方读取／发送 DTO、信号与关闭结果，或 `{ kind: "background", jobId }`；Native 渲染会应用上述呈现上限。

#### Token 影响

终端自身与策略产生的单文本结果随数据变化，并受 `maxResultBytes` 限制；如果策略有意替换为结构化多块内容，则由该策略负责限制内容。每个返回结果都会保留在历史中直到压缩。

#### KV Cache 影响

仅追加；新结果位于可复用请求前缀之后。

## 已知限制与暂缓事项

- 不公开具名按键序列、TUI、BEL、调整大小、自动启动或跨 agent 共享 schema。
- 后台模式同时依赖 `@deepseek-ai/dsh-jobs` 及其面向模型的控制器。
