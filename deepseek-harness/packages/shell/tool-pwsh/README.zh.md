# @deepseek-ai/dsh-tool-pwsh

[English](README.md) | 中文

注册在 `ctx.shell` 执行器 seam 之上的面向模型的 `pwsh` 工具。面向由 PowerShell 执行器（如 `@deepseek-ai/dsh-pwsh-local`）支撑 `ctx.shell` 的 Windows 组合；工具约定是 PowerShell 方言：原生 `C:\...` 路径与 `$env:NAME` 变量。行为与 `dsh-tool-bash` 逐调用对齐——通过通用任务运行时执行前台与 `run_in_background`、通过共享 `shell-env` 注册表管理 `DSH_*` 环境、sandbox 拒绝渲染与同轮次 `sandbox_permissions` 升级面、以及 bash 的 marker/截断渲染故事（干净退出不产生 marker）。

需要已加载的执行器实现与 `shell-env` 插件；两者都存在前工具保持 pending（`inject: ['tools', 'bash', 'systemPrompt', 'bashEnv']`）。

包根只导出 Cordis 插件约定（`name`、`inject`、`Config`、`apply`）；结果渲染（`src/render.ts`）与后台任务适配（`src/background.ts`）镜像 bash 工具的结构，并可通过包的 `./src/*` 导出访问。

插件还贡献 `tool:pwsh` 提示词段落（order 105）：非零退出以 `[exit code: N]` marker 报告，Windows 上的中断以无 signal 的 exit 1 结算。

## 工具

### `pwsh`

| Arg | Type | Notes |
|---|---|---|
| `command` | string (required) | 通过 `pwsh -Command` 运行。调用之间不保留状态——用 `workdir`，不要用 `cd`。 |
| `description` | string (required) | 命令的一行主动语态摘要（5-10 词），仅用于 UI/日志展示——不影响执行。 |
| `timeoutMs` | number | 超时覆盖值（毫秒）。执行器应用其配置的默认值与上限。 |
| `workdir` | string | 本次调用的工作目录。默认取调用 agent（智能体）的会话 cwd（`session.header.cwd`），使每个会话在自己的工作区运行；相对 `workdir` 基于同一身份解析。 |
| `run_in_background` | boolean | 立即返回 job id；不适用超时。 |
| `sandbox_permissions` | string enum | 仅当已挂载 sandbox 执行器时才会公开（`ctx.shell.sandboxMode` 已定义）。用于对刚被 sandbox 拒绝的命令做一次性重试的更宽 sandbox 模式——取刚好足够的最窄更宽模式，要求 `justification` 并在执行**之前**经 `ctx.approval` 获得用户批准。未拓宽或无法获批的请求 fail-closed，不运行任何内容。 |
| `justification` | string | 必须与 `sandbox_permissions` 一同提供：用一句话向用户解释为何正是这条命令需要更宽的访问。 |

`command`、`workdir` 与 `timeoutMs` 在执行前经 `ctx.shell.resolve()` 按执行器配置默认值解析。workdir 默认值在工具层于 `resolve()` 之前从调用 agent 的 `session.header.cwd` 取得——每次会话的 cwd 必须来自 `exec.agent`，因为 N 个会话共享一个执行器；仅当没有会话 cwd 时执行器才回退到自己的配置 / `process.cwd()`。

### Managed shell environment

每次前台与后台模型 pwsh 调用都会通过共享的 [`dsh-shell-env`](../shell-env/) 注册表收到一份新收集的受信任 `DSH_*` 环境：`DSH_HOME`（Harness 主目录绝对路径）、`DSH_SHELL=1`、agent 的 `DSH_SESSION_ID`，以及活跃持久化后端定位到 JSONL 时的 `DSH_SESSION_JSONL`。向 `ctx.shellEnv` 贡献 `DSH_*` 事实的插件对 pwsh 调用与 bash 调用一视同仁。快照通过专用的 `ShellExecRequest.dshEnv` 通道传递；`process.env` 永不被修改。描述只教授通用的 `$env:DSH_*` 约定，而不是点名持久化相关的变量。

结果文本包含 stdout、可选的 `[stderr]` 段，然后是适用的截断、sandbox 拒绝（组合公开升级能力时带同轮次升级提示）、超时、signal 与退出 marker。干净退出（0、无 signal）不产生 marker；空体渲染为 `(no output)`。截断会链接一个安全的完整 spill 文件，或报告其不可用。超时独立于最终退出状态报告；非零退出仍是模型解读的结果而非 `isError`。Windows 上强制终止以无 signal 的 exit 1 结算，因此 `[killed by signal: …]` 仅适用于 POSIX。只有基础设施失败——spawn 错误与中止（`tool call aborted`）——产生 `isError`。

规范成功形态是已完成前台进程的 `{ kind: 'foreground', ...ShellRunResult }`（存在时投影执行器的 `sandbox` 事实——`mode`/`denied`、可选的 `enforcement`/`runnerFailed`）或已发布任务的 `{ kind: 'background', jobId }`。渲染器对后台 ack 精确保留 `started background job <id>`；编程消费者使用类型化字段而不解析渲染文本。

当 `run_in_background` 为 true 时，本插件在 spawn 前预检 `ctx.jobs.start()`，把调用 agent 注册为 owner，并将返回的 `ShellProcess` 句柄适配为通用的 cancel/done/增量输出钩子。任务运行时负责 job id、跨会话隔离、完成通知、等待和 dispose（资源释放）清理；本插件只把 pwsh 退出事实映射进任务输出与结果明细。`enableRunInBackground: false` 会移除参数并在执行时拒绝强制的后台调用。

## UI presentation

工具拥有自己的 `presentCall`/`presentResult` 呈现意图。前台调用是携带命令、描述与可选 cwd 的 `terminal` 卡；`run_in_background` 调用是携带原始命令的 `generic` 卡，镜像 bash 工具的后台呈现。完成的前台结果同样是 `terminal` 卡：退出 marker 变成卡片的退出状态 pill（`exitCode`/`signal`），去 marker 的正文成为卡片输出——与 bash 工具的 terminal 卡故事完全一致，经由 `@deepseek-ai/dsh-shell` 的共享退出状态解析。后台 ack 与执行错误保持 `generic` 卡，以 `console` 围栏包裹渲染输出。这些 presenter 是纯函数且可重放。

## 模型体验

### 系统提示词

#### 模型看到的内容

本插件注册作用域内的每个请求都包含下面的 pwsh 指引。作用域工具限制可以隐藏 schema，但不会移除这个独立注册的段落。

##### Pwsh guidance

```markdown
Non-zero exits are reported as `[exit code: N]` markers; investigate failures before moving on. On Windows a killed process settles as `[exit code: 1]` without a signal marker; treat a bare exit 1 after an interruption as a termination, not a command failure.
```

#### Token 影响

插件激活期间每次请求的固定小额输入成本。

#### KV Cache 影响

注册作用域与 prompt 文本不变时前缀稳定。插件激活或释放可能使该 prompt 段落的复用失效。

### 工具 schema

#### 模型看到的内容

模型看到生成的 [`pwsh` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-pwsh)。按 agent 作用域的工具限制可以移除该 agent 的定义。

#### Token 影响

工具可见的每个请求上的固定 schema 成本。

#### KV Cache 影响

可见性与工具定义不变时前缀稳定。限制或配置变更可能从首个变化 token 起使复用失效。

### 前台结果

#### 模型看到的内容

渲染器输出数据相关的 stdout 尾部，然后是可选的 `[stderr]` 与 stderr 尾部。条件行精确为 `[output truncated; full output: <path>]`、`[sandbox: file access denied under <mode> mode]` 加升级提示 `[sandbox: escalation available — …]`（仅当组合公开升级能力时）、`[timed out after <timeoutMs>ms]`、`[killed by signal: <signal>]` 与 `[exit code: <exitCode>]`（仅非零退出）；空体渲染为 `(no output)`。

#### Token 影响

调用前零结果 token。每个流的输出有界，而每条已发出的行保留在历史中直到压缩。

#### KV Cache 影响

仅追加；新出现的内容跟随可复用的请求前缀，不会使既有 KV Cache 条目失效。

### 后台结果

#### 模型看到的内容

后台启动精确渲染为 `started background job <id>`；随后的读取与状态通过通用 `job_output`/`job_kill` 工具流转，包括内存截断丢弃未读字节时的 lossy 读取 spill 通知。

#### Token 影响

ack 是固定短行；任务输出按读取有界。

#### KV Cache 影响

仅追加；新出现的内容跟随可复用的请求前缀，不会使既有 KV Cache 条目失效。

### 工具错误

#### 模型看到的内容

校验与基础设施失败规范化为 `Error: <message>`。本包的稳定消息包括 `invalid command: expected a non-empty string`、`invalid description: expected a non-empty string`、`invalid timeoutMs: expected a positive number, got <value>`、`invalid escalation: sandbox_permissions requires a justification`、`invalid escalation: justification is only valid together with sandbox_permissions`、`invalid justification: expected a non-empty sentence`、`sandbox_permissions is not available in this composition (no sandboxing executor to escalate)`、共享的升级失败（非严格更宽、无审批服务、无 agent 可路由、无审批通道、用户拒绝、已取消）、`run_in_background is disabled for this deployment (enableRunInBackground: false)`、`background jobs unavailable: load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs` 与 `tool call aborted`。

#### Token 影响

只有失败的调用会新增这些保留 token；被中止的调用不产生命令输出。

#### KV Cache 影响

仅追加；新出现的内容跟随可复用的请求前缀，不会使既有 KV Cache 条目失效。

## 已知限制与暂缓事项

- **Windows 沙箱下的语言模式与 named-pipe 捕获** — 在 [Windows ACL 沙箱](../../sandbox/sandbox-windows-acl/README.md) 下，read-only pwsh 会以 ConstrainedLanguage 启动，因为临时目录写入被拒绝，导致 PowerShell 的 AppLocker 探针失败并按 fail-closed 处理：`Add-Type`、非核心 .NET 静态调用（`[System.IO.*]::`、`[math]::`）、COM 对象与反射都会以“only core types”错误失败，且该模式无法从内部解除。workspace-write 的私有临时目录使探针得以完成，因此除非主机策略另有规定，否则它保持 FullLanguage。两种受限模式都拒绝 named-pipe 打开，因此受限命令内的管道 stdio spawn 以 EPERM 失败。工具描述把这两个约定教给模型；后端 README 负责完整的限制说明。
- **无持久 shell 或 PTY** — 每次调用都启动全新的 `pwsh -Command`；PTY 后端目前仅限 Linux/macOS，Windows ConPTY 持久 shell 属于路线图工作。
- **PowerShell 方言约定** — 模型必须写 PowerShell（原生路径、`$env:` 变量），而不是 bash；没有方言翻译。
- **会话 cwd 身份不做规范化** — workdir 基座直接取会话头 cwd 原值，不同于 bash 工具经 sandbox-root 规范化的身份。在隔离执行器下，策略的工作区根**会**被规范化（由共享的策略服务完成），因此当原始会话 cwd 与其规范化形态不同时，workdir 与隔离根可能不一致——这一 parity 差距留待共享 shell 工具基座提取时解决。
