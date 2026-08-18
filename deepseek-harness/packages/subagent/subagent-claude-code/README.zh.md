# @deepseek-ai/dsh-subagent-claude-code

[English](README.md) | 中文

本包（package）注册固定的 `claude-code` subagent 提供方。每次接受运行请求后，它都会在发起委托的会话工作区中调用官方 Claude Agent SDK，通过共享子进程服务解析原生 `claude` 可执行文件，提交一个自包含的文本任务，并通过共享的 [`dsh-subagent`](../subagent/README.md) 结果约定仅返回最终答案。

## 启动与所有权

`start(request)` 只接受非空的文本块序列，并根据父会话确定子级 cwd。它会创建一个私有 `AbortController`，调用官方 SDK 的 `query()`，并仅在 SDK 的 `spawnClaudeCodeProcess` 钩子已经提供由 [`dsh-subprocess`](../../subprocess/subprocess/README.md) 管理的活动 CLI 句柄后发布此次运行。若在发布前发生失败或取消，它会关闭 query、终止所有已取得的进程树并等待其退出，然后拒绝 `start()` 调用。

SDK 接收由文本块原样拼接成的任务。提供方会完整迭代 SDK 消息流，而且只接受满足以下条件的 `result` 消息：其 `subtype: "success"`、`is_error: false` 且 `result` 非空白，之后迭代器还须正常结束。所有 SDK 错误子类型、标记为错误的成功消息、缺失答案、迭代器失败、协议失败或进程失败都映射为 `error`；该提供方不会产生 `max-tokens` 或 `refusal`。

本地取消会在结果竞态中胜出并映射为 `aborted`。`dispose()`（资源释放）具有幂等性：它会中止此次运行、请求 SDK query 关闭、调用共享的进程树逐级终止机制，并等待整棵进程树退出。SDK 的优雅关闭只表达协议意图；进程是否完全停稳仍以子进程句柄为准。结果失败与独立的清理失败仍彼此分离。

## 原生设置与交互

提供方故意省略 SDK 的 `settingSources` 选项。因此，官方 SDK 会相对于父会话 cwd 读取宿主机常规的用户、项目和本地 Claude 设置，包括原生账户状态与产品配置。提供方既不复制也不过滤这些文件，也不会创建或修改登录状态。

每次 query 都设置 `persistSession: false` 并禁用 `AskUserQuestion`。提供方不设置 `canUseTool`、elicitation 或对话回调，因此无人值守交互会经 SDK 失败，而不会等待本提供方不负责的用户界面。

## 能力与上下文

本提供方不声明任何可选的启动时能力，并报告 `inheritsParentContext: false`。Claude Code 会接收独立文本任务和父会话 cwd，但不会接收父会话的对话、角色设定、工具筛选器、深度策略或结构化输出约定。每次运行都拥有独立的 SDK query、取消控制器、CLI 进程和不持久化的产品会话。

## 配置

| 配置键 | 默认值 | 含义 |
|---|---|---|
| `env` | `{}` | 显式指定的 SDK/CLI 环境，叠加在由共享机制清除凭证后的父环境之上。 |
| `disposeGraceMs` | `3000` | 共享进程树责任方各终止层级之间的宽限期，单位为毫秒且须为正有限值，并不得大于仓库共享的 [`MAX_TIMER_DELAY_MS`](../../util/timeout/README.md)；随后资源释放会等待整棵进程树退出。 |

生产环境从子进程执行世界清除凭证后的 `PATH` 解析 `claude`，再应用显式 `env` 条目，并把所得路径作为 `pathToClaudeCodeExecutable` 交给 SDK。在 Windows 上，解析到的 `.cmd` 或 `.bat` 路径会作为带引号、仅供本次 spawn 使用的环境值交给 `cmd.exe /v:off` 展开一次，因此合法路径中的元字符仍只是数据。锁定版本的 SDK 随后把固定命令行选项放在 cmd 的命令尾部；这些选项不含 cmd 元字符，也并不是普通的 Windows argv。原生设置与身份验证继续是权威来源。本插件不安装另一份 CLI、不选择模型、不创建产品主目录、不执行登录，也不探测账户。具有凭证特征的环境变量会在显式 `env` 覆盖生效前被清除，因此供子进程使用的 API 密钥或 token 必须在该配置中显式提供。除非被覆盖，`ANTHROPIC_BASE_URL` 等非凭证端点变量以及 `PATH` 和 `HOME` 等普通环境变量仍会被继承。

生产 `dsh` 不会安装或挂载这个可选提供方。选择启用它的 Profile 必须安装 `@deepseek-ai/dsh-subagent-claude-code`，并在 host plane（宿主平面）挂载一次；加载提供方本身不会在工具调用前启动 Claude 进程。完整 Agent Preset 携带对应的产品工具行并设置 `disabled: true`；复制一个 preset 后删除该字段，即可只向由该副本组装的 agent 暴露 `subagent_claude_code`。其 `one-shot` 策略会让省略 `run_in_background` 或传入 `false` 的调用继续在前台等待，而显式传入 `true` 会返回由父 agent 拥有的 Job ID，供 `job_output` 或 `job_kill` 使用。base host（基础宿主）与完整 preset 已提供通用作业注册表和控制工具。

下列独立组装展示完整的显式能力。基于 `@deepseek-ai/dsh-base` 的 Profile 保留已有 Job 行，只新增产品提供方行并启用 preset 工具行，禁止重复挂载 Job 服务。

```yaml
- id: subagent-claude-code
  name: '@deepseek-ai/dsh-subagent-claude-code'
  config:
    env:
      ANTHROPIC_API_KEY: !!js process.env.ANTHROPIC_API_KEY

- id: jobs
  name: '@deepseek-ai/dsh-jobs-local'

- id: tool-jobs
  name: '@deepseek-ai/dsh-tool-jobs'

- id: tool-subagent-claude-code
  name: '@deepseek-ai/dsh-tool-subagent'
  config:
    provider: claude-code
    toolName: subagent_claude_code
    backgroundMode: one-shot
    maxDepth: provider-managed
```

## 产品兼容性与证据

运行时依赖精确锁定为 `@anthropic-ai/claude-agent-sdk@0.3.220`。生产运行使用原生 `claude` 安装。无密钥真实产品测试使用由 SDK 分发的 Claude Code 2.1.220 CLI 作为确定性 fixture（测试前置数据），并通过同一套原生可执行文件解析路径与 Windows batch shim 路径运行；这项测试不声称兼容每个独立安装的版本。Loader 组合证明两个产品包能够共存且不会启动任一产品。

限定于项目所有者身份的分发授权涵盖官方 SDK 及每个 SDK 版本声明的官方 CLI／平台载荷。[`THIRD_PARTY_NOTICES.md`](../../../THIRD_PARTY_NOTICES.md) 会披露当前可选载荷闭包，但不会认定其中声明的条款属于宽松许可；其他无关的非宽松运行时依赖仍会使第三方声明门禁失败。

## 模型体验

### 子级请求

#### 模型看到的内容

Claude Code 子级会在一个全新的 SDK query 中接收独立文本任务。它的工作区是父会话 cwd；其模型、系统指令、工具、权限和身份验证来自宿主机原生 Claude 设置与产品安装。

#### 对 token 的影响

子级需为独立的 Claude Code 上下文和 query 承担 token 开销。子级 token 不会进入父级上下文。

#### 对 KV Cache 的影响

这与父请求缓存相互独立。能否复用只取决于 Claude Code 自身的模型、指令、工具、原生设置和全新 query。

### 父级调度与结果（间接）

#### 模型看到的内容

通过 `dsh-tool-subagent`，前台调用会让父级模型看到符合严格成功条件的 Claude Code 最终答案，或者在结果未完成时看到消费方给出的原样错误。后台调用会先返回 Job id；随后通用作业控制面会送达完成通知，通过 `job_output` 公开最终答案与状态，并允许 `job_kill` 请求取消。Claude Code 的推理、工具活动、中间消息、stderr、工作区差异、用量信息和产品标识符均不会复制到父会话。

#### 对 token 的影响

前台输入会增加工具结果中保留的最终答案或错误内容。后台输入还会包含启动确认、完成通知，以及 `job_output`、`job_kill` 或后续状态结果；子任务 token 仍不会进入父级上下文。本提供方自身不添加父级工具 schema。

#### 对 KV Cache 的影响

仅追加：前台会在可复用的父请求前缀后增加一个结果，后台则会继续追加 Job 启动确认、通知以及后续控制或收集结果。后台调度可能增加一个由通知唤醒的轮次，但这些消息都不会改写更早的前缀。

## 已知限制与后续工作

- **每次运行均新建一个 query 和一个进程**：不支持续接、恢复、池化、进度流或产品会话持久化。
- **宿主设置有意保持权威**：项目和用户设置可以改变模型、工具与行为；本提供方不提供经过筛选或与宿主环境隔离的生产模式。
- **产品安装与账户状态仍由原生机制管理**：`claude` 缺失或不兼容、配置错误或身份验证失败都会呈现为启动错误或运行错误；本插件不提供安装程序或登录流程。
- **SDK 平台 CLI 仍在安装闭包内**：生产环境会忽略它，改用宿主提供的 `claude`，但当前 SDK 的可选依赖仍会安装，并提供无密钥兼容性 fixture。移除该载荷属于独立的产品安装闭包后续项。
- **没有人工交互路径**：`AskUserQuestion` 被禁用，其他交互回调也不存在，因此需要新审批或输入的任务会失败而不会挂起。
- **产品载荷仅包含最终文本**：推理、中间消息、工具通信、用量信息、stderr 和工作区差异仍只保留在产品内部；通用 Job id、通知与状态来自共享作业运行时。
- **没有可选的共享能力**：对于本提供方，共享服务会拒绝输出 schema、子任务角色设定、工具筛选和 harness 深度强制约束。
- **没有按实际经过时间触发的超时或副作用回滚**：长时间运行的工作由调用方取消，且取消前已更改的文件或外部系统不会恢复原状。
