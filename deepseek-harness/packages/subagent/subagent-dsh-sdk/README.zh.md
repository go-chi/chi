# @deepseek-ai/dsh-subagent-dsh-sdk

[English](README.md) | 中文

SDK 提供方会在全新的子进程中把每个 subagent 作为完整的 DeepSeek Harness 运行时运行，并经由 [TypeScript SDK 客户端](../../sdk/client/README.md) 通过 stdio JSON-RPC 驱动。它是 [`subagent-acp`](../subagent-acp/README.md) 之外的第二个进程外后端，差异在协议格式（wire format）和子进程约定：ACP（Agent Client Protocol）后端能驱动任何 Agent Client Protocol agent（智能体）；本后端专门驱动 harness SDK 运行时（`dsh-jsonrpc-agent` bin 或打包后的可执行文件），因此子进程是一个完整的对等 harness，拥有由 `cordis.yml` 决定的组合、会话持久化、模型路由和工具。

## 启动与所有权

`start(request)` 先解析子进程工作目录，通过 `DeepSeekHarness` spawn 运行时，并在履行前完成 `initialize` 握手（携带配置的 `provider`/`model` 路由及可选的 `maxTokens` 输出上限）。因此，履行意味着子运行时已就绪、所有权已移交给调用方。spawn、握手或发布前取消失败时，只会在子进程被回收后拒绝；工作目录解析失败则会在尚未 spawn 任何内容时拒绝。

工作目录的解析与 ACP 后端完全一致，并使用 seam 共享的进程外辅助工具（[`dsh-subagent`](../subagent/README.md)）：设置了 `cwd` 覆盖值时使用该值（加载时校验一次），否则使用发起委派的父会话 cwd，绝不使用服务器进程自身的 cwd。解析出的路径同时成为子进程 cwd 和其 SDK 会话的工作区 cwd。

返回的 run id 在父级命名空间中生成；子运行时的会话 id 只存在于子进程内部。发布后，提供方拥有一段 SDK 活动，并从子会话事件中读取答案：最后一条完整且非空的 `assistant/message`（记录 usage 的空内容消息会被跳过）；若没有这类消息，则取累积的 `text-delta` 流。取消或发生错误后，部分输出仍然可用。

`dispose()`（资源释放）是幂等的：先在本地把结果确定为 `aborted`（协议层面没有提示词取消机制），再关闭运行时，即先发出一次有界的协议 `shutdown` 请求，随后通过共享的 stdin-EOF → SIGTERM → SIGKILL 阶梯使进程实际退出。

## 停止原因映射

SDK 客户端返回自有子活动，而不是提示词结果。提供方读取该活动内最后一个已持久化的 `turn/end`，并将其映射为 seam 词汇：`completed` → `completed`，`max-tokens` → `max-tokens`，`aborted` → `aborted`；其余情况，包括 `error`、`interrupted`、`disposed`、未来变体或不含轮次的活动，均映射为 `error`，因此非正常停止绝不会报告为成功。发布后的传输层失败会通过 `onError` 诊断接收器（连接到 `ctx.logger.warn`）压平为 `stopReason: 'error'`；seam 约定禁止 `result` 被拒绝。

## 能力与上下文

Provider 不宣告任何启动期能力（`outputSchema`/`depthLimit`/`toolFilter`/`persona` 全为 false），且 `inheritsParentContext: false`：子进程是另一进程里的全新运行时，唯一来自父方的输入是工作区 cwd。基于本 provider 的 `dsh-tool-subagent` 部署应设置 `maxDepth: 'provider-managed'`——子 harness 拥有自己的递归预算。

## 配置

| 键 | 默认 | 含义 |
|---|---|---|
| `providerName` | `dsh-sdk` | `ctx.subagents` 上的注册名。 |
| `command` | 必填 | 每次运行时 spawn 的可执行文件（子运行时 bin 或打包后的可执行文件）。 |
| `args` | `[]` | 命令参数（通常是子进程的 `cordis.yml` 路径）。 |
| `cwd` | 父会话 cwd | 工作目录覆盖；校验规则与 [`subagent-acp`](../subagent-acp/README.md) 相同。 |
| `provider` | `deepseek-official` | 写入子进程 `initialize` 的提供方路由。 |
| `model` | `deepseek-v4-flash` | 写入子进程 `initialize` 的模型。 |
| `maxTokens` | 适配器／提供方路由默认值 | 写入子进程 `initialize` 的单次请求输出 token 上限；对子运行时的根 agent 及其进程内后代生效。 |
| `env` | `{}` | 在凭据擦除后的父环境之上叠加的显式子环境（例如子进程自己的 `DEEPSEEK_API_KEY`，或 `DSH_CORDIS_CONFIG`）。 |
| `shutdownTimeoutMs` | `1000` | dispose 期间协议 `shutdown` 交换的时限。 |
| `disposeEofGraceMs` | `6000` | stdin EOF 之后、平台终止之前的宽限。 |
| `disposeGraceMs` | `3000` | 终止后的退出确认窗口；POSIX 在 SIGTERM 之后、SIGKILL 之前也等待同样时长。 |

```yaml
- id: subagent-dsh-sdk
  name: '@deepseek-ai/dsh-subagent-dsh-sdk'
  config:
    providerName: dsh-sdk
    command: node
    args: ['./packages/examples/jsonrpc-demo/lib/bin.js', './examples/jsonrpc-agent/cordis.yml']
    maxTokens: 49152
    env:
      DEEPSEEK_API_KEY: !!js process.env.DEEPSEEK_API_KEY
- id: tool-subagent
  name: '@deepseek-ai/dsh-tool-subagent'
  config: { provider: dsh-sdk, toolName: subagent, maxDepth: 'provider-managed' }
```

## 进程边界

子进程环境以 [`dsh-subprocess`](../../subprocess/README.md) seam 的 `scrubbedParentEnv()` 为基础，先移除疑似凭据和名称为 `DSH_*` 的环境变量，再合并显式 `config.env` 值。子进程由 SDK 客户端 spawn，而不是经由 `ctx.subprocess` spawn（这是 subprocess README 中记录的 SDK 托管传输例外），因此本后端会自行执行环境清理。JSON-RPC 协议格式才是真正的序列化边界。

本包没有默认导出。否则 Cordis loader 解包会隐藏具名 `inject` 元数据；见[事故复盘（postmortem）0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.md)。

## 模型体验

### 子 agent 请求

#### 模型看到的内容

子运行时的模型会收到作为用户消息的独立任务，以及该运行时自身配置的系统提示词、工具和全新会话。它不会收到父级对话。本提供方不声明可选的启动时能力，因此本地服务会拒绝要求 persona、工具过滤、深度强制或结构化输出的请求，而不是静默省略这些要求。

#### Token 影响

子运行时会为独立的完整上下文及其多步骤历史消耗 token。这些 token 绝不会进入父级上下文。

#### KV Cache 影响

与父级请求缓存相互独立。每个 SDK 子进程只能复用其自身提供方、模型、组合和历史均相同时的前缀；除此之外，子 agent 的步骤仅追加增长。

### 父级工具结果（间接）

#### 模型看到的内容

经由 `dsh-tool-subagent`，父级只会收到子运行时最终的 assistant 文本（或累积的部分文本），或该消费方给出的精确停止原因错误；不会收到中间消息或工具流量。

#### Token 影响

父级输入只增加最终结果或错误，其大小取决于数据，并保留到压缩（compaction）为止。本提供方自身不会向父级添加任何 schema。

#### KV Cache 影响

仅追加；新增可见内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

## 已知限制与暂缓事项

- **每次运行都使用全新的运行时进程**：不使用进程池；harness 运行时需要启动完整的插件树，因此每次运行的 spawn 成本高于 ACP 后端通常使用的子进程。
- **不支持可选的启动时能力**：父级无法在子进程内强制执行 `outputSchema`、深度限制、工具过滤或 persona；应改为配置子进程自身的 `cordis.yml`。
- **子进程的 transcript（文本记录）保留在其自身的会话根目录中**：父级日志只记录委派工具调用／结果（seam 的子级隔离规则）；流式 `session.event` 通道只用于提取输出，不会桥接到父级日志中。
- **仅支持本地子进程**：解析出的 cwd 是本地路径；远程运行时需要独立的后端。
