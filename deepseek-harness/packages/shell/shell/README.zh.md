# @deepseek-ai/dsh-shell

[English](README.md) | 中文

**`ShellExecutor`**（`ctx.shell`）定义 bash 后端做什么，即运行前台命令与启动后台进程，但不规定如何实现。job id、所有权、收集、取消与通知属于通用 `ctx.jobs` 运行时。

本包承担 bash 能力的 Service Definition 角色，各角色因此可以独立演进（和替换）：

| 包 | 职责 |
|---|---|
| `@deepseek-ai/dsh-shell`（本包） | Service Definition：抽象服务 + 词汇类型 |
| `@deepseek-ai/dsh-bash-local` | Service Provider：本地子进程 |
| `@deepseek-ai/dsh-bash-sandbox` | Service Provider：沿用 `dsh-bash-local` 的机制，但通过 [`ctx.sandbox`](../../sandbox/sandbox/) 限制每次 spawn，并将拒绝报告为结果事实 |
| `@deepseek-ai/dsh-tool-bash` | 基于 `ctx.shell`、面向模型的工具 schema |

该拆分是一个标准的能力 seam（[capability-seams Agent Note](../../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md)）：`dsh-bash-sandbox` 是位于同一 Service Definition 之后的沙箱执行器——Consumer 检测其 `sandboxMode` 能力并添加升权字段，无需导入提供方——容器化或远程执行器也可以同样接入。

## 服务 API（`ctx.shell`）

| 成员 | 语义 |
|---|---|
| `run(spec)` | 前台执行。命令完成时 resolve。**只会因基础设施失败而 reject**（工作目录不可用、shell 缺失、信号已在调用前中止）；非零退出、超时终止和中止导致的终止都会 resolve 为描述性 `ShellRunResult`。 |
| `start(spec)` | 后台执行。立即返回不含任务语义的 `ShellProcess` 句柄；**不应用超时**。调用方可以将其适配到 `ctx.jobs`。 |
| `sandboxMode` | 工具层的能力事实：沙箱执行器用于限制执行的默认模式（基类中为 `undefined`，即「此执行器不使用沙箱」）。`dsh-tool-bash` 会在注册时读取它，仅当组合确实支持升权字段时才公布这些字段。 |
| `ShellProcess.readOutput()` | **增量** 读取输出：连续读取绝不会重复交付。因缓冲区容量限制而丢失数据的读取会标记 `lossy`，并指向完整流 spill 文件。 |
| `ShellProcess.kill()` | 终止进程组。如果进程已结束，返回 `false`。 |

实现会继承 `ShellExecutor` 并实现抽象方法。dispose（资源释放）必须终止每个运行中的进程并等待其退出。

`SHELL_SETTINGS_NAMESPACE`（`bash`）由此处导出而非由某个提供方导出，因为它命名的是能力而不是实现。一个宿主只组装一个 `ctx.shell` 提供方——win32 层会把 POSIX 行换成 pwsh 行，同时挂载两者会因服务重复注册而在加载期失败——所以每个提供方都能用自己的 schema 与组装条目注册这同一个命名空间，两者永不相撞；在平台间携带的 `settings.yaml` 也能在两边继续解析。

## 词汇

`ShellExecRequest`（command、workdir?、timeoutMs?、stdoutMaxBytes?、signal?、stdin?、env?、dshEnv?、sandboxPolicy?）在执行前解析为 `ShellExecSpec`（command、workdir、timeoutMs、stdoutMaxBytes、signal?、stdin?、env?、dshEnv?、sandboxPolicy）。`stdoutMaxBytes` 是受信任前台运行的捕获预算，用于必须解析完整有界 stdout 的消费方；面向模型的 bash 工具不公开该字段。`sandboxPolicy` 在请求上可选，在已解析 spec 上必填但可为 null：它携带完整的每次调用模式与工作区根目录。沙箱工具路径通过 `ctx.sandboxPolicy` 从调用会话解析它；沙箱执行器的直接调用方回退到部署策略，非沙箱执行器则携带该字段但不作限制。

每会话沙箱模式覆盖词汇（`'sandbox/mode'` 事件、`effectiveSandboxMode(events)` fold 以及 `setSandboxMode(session, mode)` 写入路径）不位于此处。它是所有强制执行家族共享的策略状态，属于 [`@deepseek-ai/dsh-sandbox-policy`](../../sandbox/sandbox-policy/)。`run()` 返回 `ShellRunResult`；`start()` 返回 `ShellProcess`，其增量读取与终止方法由 `dsh-tool-bash` 适配为通用任务注册。沙箱执行器会在前台结果与已结算进程句柄上标记 `ShellSandboxInfo`。详见 `src/types.ts` 与 [subsystems/shell.md](../../../docs/subsystems/shell.md)。

`stdin` 与普通 `env` 由同进程插件（hooks 桥接、原生插件）设置，用于向 hook 命令提供其 JSON payload 和 `CLAUDE_PROJECT_DIR`／`CLAUDE_PLUGIN_ROOT` 值。`dshEnv` 是受类型限制、仅允许受管 key 的独立受信任 overlay；导出的 `DSH_ENV_PREFIX` 是该 namespace、其 `DshEnvironmentKey` 模板类型、执行器清理、注册表验证、派生内置名称与模型指引的统一来源。模型 bash 使用 `ctx.shellEnv` 收集的当前快照。实现会移除继承的受管 key，再在普通 `env` 之后合并 `dshEnv`，因此省略的当前事实不会回退到陈旧环境状态，`env` 条目也无法顶掉受管值。面向模型的工具不将这三者中的任何一个公开为参数。这三者在已解析 spec 上仍然可选；缺失表示没有输入／overlay。详见 [bash-stdin-env Agent Note](../../../.agents/notes/implemented/architecture/2026-06-30-bash-stdin-env-trusted-plugin-api.md) 与 [会话环境 Agent Note](../../../.agents/notes/implemented/feature/2026-07-10-agent-session-identity-and-log-location.md)。

导出的 `parseExitStatus`（连同 `ParsedExitStatus`）是 shell 工具共享渲染约定的另一半：`dsh-tool-bash` 的 `renderResult` 与 `dsh-tool-pwsh` 的 `renderPwshResult` 追加的 `[exit code: N]`／`[killed by signal: X]` marker 的逆解析。两个工具的 `presentResult` 都用它把渲染文本拆成 terminal 卡的输出正文与其退出状态 pill；它放在 Service Definition 中，两个工具便永远不会在 marker 约定上漂移。

## 模型体验

通过 `dsh-tool-bash` 间接影响；该工具会将执行器输出与沙箱事实转为指引和保留的工具结果 token。

#### KV Cache 影响

不会直接导致 KV Cache 失效；请求前缀变更由具名消费方负责。

## 已知限制与暂缓事项

- **没有交互式输入词汇**：`stdin` 只会在 spawn 时写入一次并关闭；seam 不提供向运行中任务继续输入的通道，也没有 PTY 会话概念。
- **前台超时始终由执行器负责**：seam 上由调用方负责 deadline 的模式已由 [工具调用超时策略 Agent Note](../../../.agents/notes/implemented/architecture/2026-07-07-tool-call-timeout-policy.md) 明确暂缓。
