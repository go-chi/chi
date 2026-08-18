# @deepseek-ai/dsh-subagent-acp

[English](README.md) | 中文

ACP（Agent Client Protocol）提供方会在全新的子进程中运行每个 subagent，并作为 Agent Client Protocol 客户端驱动它。这是 spawn 与 fork 的进程外替代方案：子 agent（智能体）拥有自己的运行时、会话、模型配置和工具。

## 启动与所有权

`start(request)` 先解析子 agent 的工作目录，再依次执行 `spawn` → ACP `initialize` → `newSession`，然后才兑现。因此，兑现表示远程会话已就绪，所有权也已转移给调用方。spawn 失败、初始化失败、新建会话失败或因发布前取消而失败时，只有在子进程已回收后才会拒绝；工作目录解析失败则会在尚未 spawn 任何进程时拒绝。

工作目录优先使用已配置的 `cwd` 覆盖值，否则使用执行委派的父会话 cwd，绝不使用服务器进程自身的 cwd，因为同一个服务器进程会服务来自多个工作区的会话。从父级取得的值必须是绝对路径，指向 harness 可以进入的目录（具备搜索权限，这是子进程 cwd 的要求）；解析后的同一路径同时作为子进程 cwd 和 ACP `session/new` 工作区。

返回的运行 id 在父级命名空间中生成。子服务器的会话 id 只用于 ACP 协议调用，因为 ACP 只保证它在该全新子进程中唯一；若将其用作父级生命周期 id，可能与另一个远程运行或本地 agent 冲突。

发布后，提供方发送提示词，并把流式 `agent_message_chunk` 文本收集到 `SubagentResult.output`。提示词/传输失败会以 `stopReason: 'error'` 兑现；如果必需的请求信号或 dispose（资源释放）请求了取消，则以 `aborted` 兑现。

`dispose()` 是幂等的。它会移除信号监听器，在可行时请求 ACP 取消，然后使用该 seam 定义的操作运行本后端自有的拆卸阶梯（`disposeAcpChild`）：先关闭 stdin 并等待 `disposeEofGraceMs` 让子进程协作式完全停稳，再触发句柄的 `terminate()` 升级（SIGTERM、spawn 宽限期、SIGKILL——Windows 直接强制终止），并等待子进程责任方给出整棵进程树的退出证明。每次运行都使用全新进程；尚未实现进程池。

## 能力与上下文

ACP 不声明任何启动时能力，因为当前进程无法强制执行远程子 agent 的深度、工具过滤、persona 或结构化输出运行时。它也报告 `inheritsParentContext: false`：远程会话从全新状态开始，唯一源自父级的输入是上述工作区 cwd；对话上下文不会跨越进程边界。

## 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `providerName` | `acp` | `ctx.subagents` 上的注册表名称。 |
| `command` | 必填 | 每次运行时 spawn 的可执行文件。 |
| `args` | `[]` | 命令参数。 |
| `cwd` | 父会话 cwd | 子进程及其 ACP 会话的工作目录覆盖值；不得为空。相对值会在加载时以 harness 启动目录为基准解析，结果必须指向 harness 可以进入的目录。 |
| `permission` | `reject` | 自动回答权限请求：拒绝，或选择第一个 `allow_once` 或 `allow_always` 选项。 |
| `env` | `{}` | 显式子进程环境，叠加到已清理凭据的父进程环境之上。 |
| `disposeEofGraceMs` | `6000` | stdin EOF 之后、平台终止之前的宽限时间须为正值，且不得大于 [`MAX_TIMER_DELAY_MS`](../../util/timeout/README.md)。 |
| `disposeGraceMs` | `3000` | POSIX 在 SIGTERM 后、SIGKILL 前的宽限时间（Windows 直接强制终止），须为正值且不得大于 [`MAX_TIMER_DELAY_MS`](../../util/timeout/README.md)。 |

```yaml
- id: subagent-acp
  name: '@deepseek-ai/dsh-subagent-acp'
  config:
    providerName: acp
    command: node
    args: ['--import', 'tsx', './packages/examples/acp-demo/src/bin.ts', '--config', './examples/acp-agent/cordis.yml']
    permission: reject
    env:
      DEEPSEEK_API_KEY: !!js process.env.DEEPSEEK_API_KEY
```

## 结束原因映射

| ACP | Harness |
|---|---|
| `end_turn` | `completed` |
| `max_tokens` | `max-tokens` |
| `refusal` | `refusal` |
| `cancelled` | `aborted` |
| `max_turn_requests` 或未知值 | `error` |

## 进程边界

子进程经由 [`dsh-subprocess`](../../subprocess/subprocess/README.md) seam spawn：共享的凭据清除先移除疑似凭据的环境变量和环境中已有的 `DSH_*` 名称，显式 `config.env` 值在清除之后合并（有意转发的 `DEEPSEEK_API_KEY` 会保留下来，`DSH_PERMISSION_MODE` 这类 `DSH_*` 部署事实也以同样的方式到达子进程——清除只丢弃其陈旧的同名环境值），stderr 会继承到父进程自身的流，dispose 则先应用本插件的 EOF 时间窗，再由子进程责任方执行 SIGTERM→SIGKILL 升级并等待整棵进程树退出。ACP 协议格式（wire format）是真正的序列化边界；同进程 subagent 值不会为防御目的而克隆。

本包没有默认导出。否则 Cordis loader 的解包会隐藏具名 `inject` 元数据；见[事故复盘（postmortem）0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.md)。

## 模型体验

### 子 agent 请求

#### 模型看到的内容

远程子 agent 通过 ACP 接收独立任务内容，并使用其自身进程配置的系统提示词、工具和全新会话。它不接收父级对话。该提供方不声明任何可选启动时能力，因此本地服务会拒绝要求 persona、工具过滤、深度强制或结构化输出的请求，而不是静默省略这些要求。

#### Token 影响

子 agent 为独立的完整上下文及其多步骤历史支付 token 成本。这些 token 绝不会进入父级上下文。

#### KV Cache 影响

与父级请求缓存相互独立。每个 ACP 子 agent 只能在其自身提供方、模型、组合和历史均相同时复用前缀；其余情况下，子 agent 步骤仅追加增长。

### 父级工具结果（间接）

#### 模型看到的内容

通过 `dsh-tool-subagent`，父级只接收子 agent 最终的流式 assistant 文本，或该消费方给出的精确结束原因错误；不接收中间消息或工具流量。发布前已经取消的请求会精确变为 `Error: subagent request was aborted before the ACP child started`；其他启动失败按原样传递为 `Error: <message>`。

#### Token 影响

父级输入只增加最终结果或错误，其内容依赖数据，并保留到压缩（compaction）为止。该提供方自身不会添加父级 schema。

#### KV Cache 影响

仅追加；新增可见内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

## 已知限制与暂缓事项

- **每次运行使用全新进程**：持久进程池属于后续优化（见 [seam Agent Note](../../../.agents/notes/implemented/feature/2026-06-21-subagent-capability-seam.md)）。
- **仅支持本地工作区**：解析后的 cwd 是交给同一台机器上子进程的本地路径；远程 ACP agent 的工作区映射需要独立的后端能力，此处尚未设计这种能力。
- **不支持可选启动时能力**：该提供方无法在远程进程内应用本地 harness 的 `outputSchema`、深度上限、工具过滤器或 persona，因此不会声明这些能力；服务会拒绝需要它们的请求。
- **只收集已提交的 `agent_message_chunk` 文本**：自动化服务器把推理（reasoning）、工具活动、计划和其他 trace 数据保留在子 agent 会话日志中，不通过 ACP 发出。
- **权限提示自动回答**（`permission: allow | reject`）：不会把子 agent 的 `session/request_permission` 呈现给人。
