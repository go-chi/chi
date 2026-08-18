# @deepseek-ai/dsh-tool-bash

[English](README.md) | 中文

模型侧 `bash` 工具，注册在 `ctx.shell` 执行器 seam 上。前台执行始终位于该 seam 之后；后台进程句柄会注册到通用 `ctx.jobs` 运行时，并通过 `job_output`、`job_list` 和 `job_kill` 控制；这些工具由 `@deepseek-ai/dsh-tool-jobs` 提供。

需要加载执行器 Service Provider（例如 `@deepseek-ai/dsh-bash-local`）与 [`@deepseek-ai/dsh-shell-env`](../shell-env/README.md) 注册表；在每个注入服务就绪之前，插件会保持等待状态（`inject: ['tools', 'bash', 'systemPrompt', 'bashEnv']`）。工具约定是 bash 方言——请挂载能解析 bash 的执行器。

包根只公开 Cordis 插件约定（`name`、`inject`、`Config`、`apply`）；结果渲染和后台进程适配仍保留在包内部。

插件还会提供 `tool:bash` 提示词段落（顺序 105）：检查每个结果中的 `[exit code: N]` 标记，发现失败时先调查原因再继续。

## 工具

### `bash`

| 参数 | 类型 | 说明 |
|---|---|---|
| `command` | string（必填） | 通过 `bash -c` 运行。调用之间不保留状态；请使用 `workdir`，不要使用 `cd`。 |
| `description` | string（必填） | 用一行主动语态概述命令（5～10 个词），仅用于 UI／日志显示，不影响执行。 |
| `timeoutMs` | number | 以毫秒为单位覆盖超时时间。执行器会应用其配置的默认值和上限。 |
| `workdir` | string | 本次调用的工作目录。默认为调用方 agent（智能体）会话 cwd 的文件系统标识（`session.header.cwd`），使每个会话都在自己的工作区中运行；相对 `workdir` 也以同一标识为基准解析。 |
| `run_in_background` | boolean | 立即返回 job id；不应用超时。 |
| `sandbox_permissions` | string enum | 仅当已挂载的执行器启用沙箱时才会公开（`ctx.shell.sandboxMode` 报告一个具有限制作用的默认值）：被拒命令所需的更宽模式，取自封闭的目标词汇 `workspace-write`/`danger-full-access`（绝不能缩减为执行器默认值；有效模式按会话确定，执行时会基于它检查是否严格拓宽，未拓宽的请求直接失败，不会向任何人发起提示）。 |
| `justification` | string | 必须与 `sandbox_permissions` 一同提供（缺少任一项都会产生验证错误）：用一句话向用户解释此命令为何需要这项更宽权限。 |

执行前，`command`、`workdir` 和 `timeoutMs` 会通过 `ctx.shell.resolve()` 依据执行器配置默认值完成解析，因此 Service Definition（`ShellExecSpec`）收到显式的 `workdir`/`timeoutMs` 值。工具层会根据调用方 agent 的 `session.header.cwd` 应用工作目录默认值，然后才调用 `resolve()`：由于 N 个会话共享一个执行器，逐会话 cwd 必须来自 `exec.agent`；只有无法取得会话 cwd 时，执行器才回退到自身配置／`process.cwd()`。存在沙箱策略时，工具会复用已经规范化的 `workspaceRoot` 作为工作目录基准，防止限制逻辑与进程启动过程对同一个会话路径拼写产生不同解析结果。

### 托管 shell 环境

每次模型发起的前台或后台 bash 调用都会通过共享的 [`dsh-shell-env`](../shell-env/README.md) 注册表收到新收集的一组可信 `DSH_*` 环境变量：`DSH_HOME`（Harness home 绝对路径）、`DSH_SHELL=1`、agent 的 `DSH_SESSION_ID`，以及当活跃持久化后端能定位时的 `DSH_SESSION_JSONL`。注册表约定——贡献方注册、重复键／未声明键的显式报错机制、内置项保留与贡献方示例——载于该包的 README。快照通过专用的 `ShellExecRequest.dshEnv` 通道传递；本地执行器会先删除继承的所有 `DSH_*` 再合并，因此嵌套 harness 和并发的父／子 agent 不会泄漏陈旧身份，且绝不修改 `process.env`。工具说明只教授通用 `$DSH_*` 约定，不会点名持久化专用变量，也不会添加永久的系统提示词段落。

结果文本依次包含 stdout、可选的 `[stderr]` 段落和适用的沙箱拒绝、超时、信号、退出代码及截断标记。超时与最终退出状态分别报告；非零退出仍是由模型解释的结果，不会成为 `isError`。截断结果会链接安全的完整 spill 文件，或报告文件不可用。只有 spawn 错误和中止等基础设施故障才会产生 `isError`。

已完成前台进程的规范成功值为 `{ kind: 'foreground', ...ShellRunResult }`，已发布任务则为 `{ kind: 'background', jobId }`。Native renderer 保留上述文本，包括精确的 `started background job <id>`；程序化消费方使用带类型字段，无需解析这些字符串。执行器的流上限仍是 `ShellRunResult` 的采集限制，并携带其 spill 路径。

当 `run_in_background` 为 true 时，此插件会在 spawn 前预检 `ctx.jobs.start()`，把调用方 agent 注册为持有者，并将返回的 `ShellProcess` 句柄适配为通用的取消／完成／增量输出钩子。任务运行时负责 job id、跨会话隔离、完成通知、等待和 dispose（资源释放）清理；此插件只把 bash 退出／沙箱事实映射为任务输出和结果详情。`enableRunInBackground: false` 会移除该参数，并在执行时拒绝强制后台调用。

## UI 展示

工具持有自己的 `presentCall`/`presentResult` 渲染意图。前台调用是终端卡片，包含命令、说明、cwd、输出和解析后的退出状态。由于卡片以独立的 pill 展示退出状态，解析所消耗的 `[exit code: N]` / `[killed by signal: …]` 标记会从输出中移除；其他所有标记（截断、超时、沙箱）都保留在输出中。后台启动只返回 job id，因此使用通用执行卡片；通用 `job_*` 工具持有各自的卡片。这些 presenter 是纯函数，可安全回放。

## 工具仅使用具名参数构建请求

`ShellExecRequest` 携带可选的 `stdoutMaxBytes`、`stdin`、普通 `env` 和托管 `dshEnv`，供可信进程内插件及此工具的环境注册表使用。模型侧工具不公开 `stdoutMaxBytes`、`stdin` 或 `env`：它使用具名的命令／工作目录／超时／信号／沙箱字段，加上从注册表收集的 `dshEnv` 来构建请求。额外模型键会被忽略，无法替换托管值。Shell 语法可以提供等价的命令级行为，而本地执行器会清除环境中的凭据和陈旧 `DSH_*` 值。参见 [stdin/env Agent Note](../../../.agents/notes/implemented/architecture/2026-06-30-bash-stdin-env-trusted-plugin-api.md)。

## 权限与升权

除非启用沙箱的执行器（[`dsh-bash-sandbox`](../bash-sandbox/)）限制命令，否则命令以执行器的完整权限运行。仅拒绝型沙箱会把拒绝作为结果事实报告，并在此渲染为拒绝标记；逐调用的允许／拒绝／询问策略由 `tools/pre-execute` waterfall（瀑布式事件）负责（参见 docs/architecture.md）。

需要升权的 bash 调用会在执行前解析 `ctx.approval`。`allowed-once` 只对该次调用应用请求模式；审批被拒、取消、不可用或缺少审批上下文时，命令完全不会执行，并返回不同的错误。发生真实拒绝后，模型可以在同一轮次中使用满足需要的最窄模式和理由重试同一命令一次；审批提示本身就是征求同意的步骤。升权绝不能预先推测，禁用或拒绝审批即为最终结果。其理由见 [沙箱 Agent Note](../../../.agents/notes/implemented/feature/2026-07-06-sandbox.md)。

## 逐会话模式切换

对于启用沙箱的执行器，每次调用依次按单次升权、会话覆盖、执行器默认值解析模式。未启用沙箱以及没有 agent 的调用不携带会话覆盖。策略归属方贡献当前且不区分具体能力的常驻模式；拒绝结果仍负责特定于该操作的有效模式与重试引导。参见 [`dsh-shell` 折叠计算](../shell/README.md)和[沙箱切换约定](../../../.agents/notes/implemented/feature/2026-07-06-sandbox.md)。

## 模型体验

### 系统提示词

#### 模型看到的内容

此插件注册作用域内的每个请求都包含下方 bash 指引。策略归属方通过自身的缓存安全运行时上下文贡献当前沙箱状态，而不改变此段落。作用域工具限制可以隐藏 schema，但不会移除这个独立注册的段落。

##### Bash 指引

```markdown
Check the [exit code: N] marker on every bash result; investigate failures before moving on.
```

#### Token 影响

插件活跃期间，每个请求都会产生少量固定输入开销，不受沙箱模式或模式切换影响。

#### KV Cache 影响

只要注册作用域和提示词文本不变，前缀即可稳定复用。插件激活或 dispose 可能从此提示词段落开始使复用失效；沙箱模式切换不会。

### 工具 schema

#### 模型看到的内容

模型会看到生成的 [`bash` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-bash)。仅当此生产方启用 `run_in_background` 时，该字段才会出现；仅当已挂载执行器声明支持沙箱时，`sandbox_permissions` 和 `justification` 才会出现。Agent 作用域的工具限制可以移除该 agent 的定义。

#### Token 影响

工具可见的每个请求都会产生固定 schema 开销；沙箱支持会增加升权字段及其条件说明段落。

#### KV Cache 影响

只要可见性、后台支持和执行器沙箱能力保持不变，前缀即可稳定复用。限制、配置或执行器发生变化时，可能从首个变化的工具定义开始使复用失效。

### 前台结果

#### 模型看到的内容

renderer 先输出依数据而定的 stdout 尾部，再输出可选的 `[stderr]` 和 stderr 尾部。没有输出时，它会精确输出 `(no output)`。条件行精确为 `[output truncated; full output: <path-or-(unavailable)>]`、`[sandbox: file access denied under <mode> mode]`、`[timed out after <timeoutMs>ms]`、`[killed by signal: <signal>]` 和 `[exit code: <exitCode>]`；沙箱升权与 runner 故障行原文列于 [`dsh-bash-sandbox`](../bash-sandbox/README.md)。

#### Token 影响

调用前结果 token 为零。每条流的输出有界，每个已输出行则会保留在历史中，直至压缩（compaction）。

#### KV Cache 影响

仅追加；新可见内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

### 后台任务上下文与结果

#### 模型看到的内容

启动会精确返回 `started background job <jobId>`。此生产方会向通用任务运行时提供增量进程输出、可选的 `[some output was dropped from memory; full output: <paths-or-(unavailable)>]`、沙箱事实，以及 `exit code: <exitCode>` 或 `signal: <signal>` 等终止详情。[`dsh-tool-jobs`](../../jobs/tool-jobs/README.md) 负责模型可见的状态行、完成通知、列表和取消响应。

#### Token 影响

启动确认很短并会保留；收集到的输出依数据而定，并受执行器流缓冲区限制。消费式读取不会重复先前输出。

#### KV Cache 影响

仅追加；新可见内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

### 工具错误

#### 模型看到的内容

验证和策略失败统一为 `Error: <message>`。此包的稳定消息包括 `invalid command: expected a non-empty string`、`invalid description: expected a non-empty string`、`invalid timeoutMs: expected a positive number, got <value>`、`invalid escalation: sandbox_permissions requires a justification`、`invalid escalation: justification is only valid together with sandbox_permissions`、`invalid justification: expected a non-empty sentence`、`background execution is disabled for this bash tool`、`background jobs unavailable: load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs`、`sandbox_permissions is not available in this composition (no sandboxing executor to escalate)`、`sandbox escalation to "<mode>" is not strictly wider than this call's current "<mode>" mode`、审批不可用／拒绝／取消变体，以及 `tool call aborted`。

#### Token 影响

只有失败调用会增加这些保留 token；升权被拒时命令不会运行，因此不会添加命令输出。

#### KV Cache 影响

仅追加；新可见内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

## 已知限制与延期工作

- **回放退出状态 pill 从结果文本解析**：如果输出最后一行恰好精确为 `[exit code: N]` / `[killed by signal: …]`，会话回放将显示错误的 pill，并且该行会从卡片正文中丢失，因为解析会把它当作自己消耗的标记；这是仅影响展示的已知残留问题。
- **`bash` 工具不采用 `timeout-policy` 预算**：根据[工具调用 timeout-policy Agent Note](../../../.agents/notes/implemented/architecture/2026-07-07-tool-call-timeout-policy.md)，它保留由执行器持有的 `BASH_TIMEOUT` 路径。
- **后台进程没有执行器超时**：工作不再需要时，调用方必须使用 `job_kill`，或依赖持有者／服务的 dispose。
