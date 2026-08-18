# @deepseek-ai/dsh-bash-local

[English](README.md) | 中文

`@deepseek-ai/dsh-shell` 执行器 seam 的本地 Service Provider，构建在 [`@deepseek-ai/dsh-subprocess`](../../subprocess/subprocess/README.md) 服务之上：`LocalBashExecutor` 每次调用都通过 `ctx.subprocess` 把 `bash -c <command>` 作为受管进程组 spawn，并负责所有 Bash 层职责（命令默认值补全与上限、超时与取消分类、适合模型的终端环境，以及后台读取时面向模型的 stdout/stderr 合并）。以 spill 文件兜底的有界输出、凭据清除、kill 升级和 dispose（资源释放）等进程组机制则由 subprocess 服务负责。

包根目录导出默认与具名的 `LocalBashExecutor` 插件及其 `Config`。

## 配置

```yaml
- id: bash
  name: '@deepseek-ai/dsh-bash-local'
  config:
    cwd: /path/to/workspace   # default: process.cwd()
    timeoutMs: 120000          # default foreground timeout
    maxTimeoutMs: 600000       # cap for per-call overrides
    maxOutputBytes: 64000      # per-stream in-memory cap; overflow spills to disk
    maxSpillBytes: 67108864    # per-stream full-output spill cap
    graceMs: 3000              # kill escalation and post-exit pipe-drain grace
```

## 行为

- **每次调用都 spawn，不保留 shell 状态**：每次调用都启动新的非登录 `bash -c`，且不读取 rc 文件。
- **组装条目是一层，而不是最终值**：当组装中存在 settings 提供方时，本执行器以上面的条目为 base 注册该能力的 [`bash` 命名空间](../shell/README.md)，因此 `settings.yaml` 中的用户段会叠加其上，下一条命令即按新预算运行。schema 无法判定的值（正有限、`graceMs` 的定时器上界）会在写入时被拒绝，运行中的执行器保持它最后一份可用的段；没有提供方、或提供方脱离之后，运行的就是组装条目。
- **在受管进程组之上应用配置预算**：`resolve()` 从配置补全 `workdir`／`timeoutMs`／`stdoutMaxBytes`，每次 spawn 都向服务传入显式的字节上限、spill 上限与 `graceMs`。该宽限期须为正有限值，且不得大于 [`MAX_TIMER_DELAY_MS`](../../util/timeout/README.md)，这样 Node 就能用一个定时器表示它。进程组终止、退出后管道排空、尾部保留与有界 spill 文件是 [`dsh-subprocess-local`](../../subprocess/subprocess-local/README.md) 的机制。前台 `ShellExecRequest.stdoutMaxBytes` 可为某个受信任调用方提高单次 stdout 捕获预算；stderr 和后台运行仍使用 `maxOutputBytes`。
- **超时与取消分类**：`run()` 通过同一个 deadline 把经配置钳位的超时与调用方的信号融合；只有执行器自身的超时报告 `timedOut`，上游取消报告 `aborted`，自身因信号终止的命令两者皆不报告（见[超时库 Agent Note](../../../.agents/notes/implemented/architecture/2026-07-06-timeout-deadline-library.md)）。
- **适合模型的终端环境**：`NO_COLOR=1 TERM=dumb PAGER=cat GIT_PAGER=cat` 防止分页器与 ANSI 颜色破坏结果。这些值作为普通 env 合并，遵循服务的凭据清除与 `DSH_*` 通道规则；调用方的显式条目依旧优先。详见 [stdin/env Agent Note](../../../.agents/notes/implemented/architecture/2026-06-30-bash-stdin-env-trusted-plugin-api.md) 与 [受管环境 Agent Note](../../../.agents/notes/implemented/feature/2026-07-10-agent-session-identity-and-log-location.md)。
- **后台进程**：`start()` 会立即返回活动的 `ShellProcess` 句柄且不应用超时；`readOutput()` 把基于偏移量的 stdout/stderr 读取合并为一条消费式增量，并在存在 stderr 时将其置于 `[stderr]` 标记下。运行中的进程属于 subprocess 服务，可在执行器重载后存活，并在服务 dispose 时被终止且等待退出。job id、所有权、轮询和通知属于通用 [`ctx.jobs` 运行时](../../jobs/jobs/README.md)，工具层会在其中注册该句柄。

## 模型体验

通过 `dsh-tool-bash` 间接影响；该工具会渲染此执行器有界的 stdout/stderr 尾部、后台进程增量、spill 文件路径与基础设施失败。

#### KV Cache 影响

不会直接导致 KV Cache 失效；请求前缀变更由具名消费方负责。

## 已知限制与暂缓事项

- **自身不提供隔离**：此执行器始终以 harness 进程的权限运行命令；需要隔离的部署可以组合 [`dsh-bash-sandbox`](../bash-sandbox/README.md)，每次调用的 allow/deny/ask 策略则属于 `tools/pre-execute`。
- **没有持久 shell 或 PTY**：每次调用都启动新的非登录 `bash -c`；仅持久化 cwd 与交互式终端会话均继续暂缓，直到真实工作流需要它们。
- **仅支持 POSIX**：`bash` 二进制已硬编码，底层服务的进程组语义也是 POSIX 的；不支持 Windows。
- **后台 spawn 失败提示只交付一次**：subprocess 服务不会为从未真正运行的进程缓冲任何输出，因此执行器把 `spawn failed: …` 注入恰好一个 `readOutput()` 增量；丢弃了该增量的读取方无法再恢复它。

凭据清除启发式规则与 spill 保留的注意事项随 [`dsh-subprocess-local`](../../subprocess/subprocess-local/README.md) 记录；这些机制归它所有。
