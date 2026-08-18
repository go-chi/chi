# @deepseek-ai/dsh-command-feedback

[English](README.md) | 中文

与触发方式无关的会话反馈，以及面向用户的 `/feedback` 采集。本包导出 `recordFeedback(session, text)`；该函数会追加一个仅写入日志的 `feedback/record` 事件。该插件通过 [`ctx.commands`](../../interaction/commands/README.md) 注册一个全局命令，因此每个已组合的命令适配器都能发现它；随附的 Web 客户端无需模型轮次即可执行。

## 命令约定

| 输入 | 结果 |
|---|---|
| `/feedback <text>` | 追加 `feedback/record`，并以 `Feedback recorded for session {sessionId}`、`Anonymous user: {userId}` 加会话共享披露确认。 |
| `/feedback` | 返回一个直接用法错误。仅含空白的输入视为空输入。 |

前后空白会被丢弃，但除此之外，反馈内容不会被解析：不进行截断或大小写折叠，也不识别控制词。看起来像另一个命令的文本（例如 `/feedback /plan felt slow`）就是反馈内容。重复执行命令时，每次都会产生一个事件；不会发生替换或合并。

## 会话共享披露

确认文本会点名接收会话的 id，并报告该会话如何被共享；该信息通过插件上下文（`ctx.get('telemetry')`，绝不是声明的注入）从已挂载的 [`telemetry`](../../session/session-telemetry/README.md) 服务读取。披露是依据后端 [`SessionTelemetrySharingStatus`](../../session/session-telemetry/README.md) 选择的一句话：

| 披露的状态 | 确认文本中的句子 |
|---|---|
| `full` | `Session sharing is enabled.` |
| `feedback-only` | `Session sharing is feedback-gated; recording feedback releases the session prefix for sharing.` |
| `disabled` | `Session sharing is disabled.` |
| 无服务 | `Session sharing is not configured.` |

披露只陈述部署当前的共享策略，绝不承诺投递或留存：在 `full` 或 `feedback-only` 下，记录被交给后端的非阻塞入队，批处理、重试与丢失策略归 SDK 负责，因此句子不声称任何内容已到达采集端；`disabled` 也不声称未来不会重新配置。披露不新增任何事件，也绝不会进入模型 surface。

## 本插件做什么、不做什么

`recordFeedback(session, text)` 是不依赖命令的写入路径。它拒绝规范化后为空的文本，并追加 `feedback/record { text }`；其他 UI、钩子或 host 集成无需构造斜杠命令即可调用它。`/feedback` 处理器通过该函数写入，且不启动任何模型工作。可选的 [`dsh-session-telemetry-otel`](../../session/session-telemetry-otel) 消费方会观察该事件，但不改变它的采集约定。

反馈文本只出现在一个持久载荷中：`feedback/record`。[`dsh-commands`](../../interaction/commands/README.md) 仍会追加通用的 `command/run` / `command/done` 配对，但此定义设置了 `recordInput: false`，因此 `command/run` 会省略 `args`；配对的 `command/done` 只携带结果。三个事件都仅写入日志，不出现在有序 surface、`deriveMessages()` 以及模型请求中。这些追加会启动持久化的常规即时排空，但两个生产方都不会强制 `session/flush`，因此确认文本表示反馈已进入日志，而不表示它已经落盘。确认文本同时标明接收反馈的会话和[共享匿名用户](../../identity/anonymous-user-id/)；对于某个 harness home，首次接受反馈时可能创建 `$DSH_HOME/.anonymous-user-id`。被拒绝的空输入只会留下以 `kind: 'error'` 结算的命令配对，不会产生 `feedback/record`，也不会查找用户 id。

权威记录是该事件，而不是命令记录，因为反馈可能来自 `/feedback` 之外的触发方式。让载荷不进入 `command/run`，可避免两条记录携带相同文本。

## 组合

生产方只注入 `commands`。自定义应用挂载注册表以及本插件：

```yaml
- id: commands
  name: '@deepseek-ai/dsh-commands'
- id: command-feedback
  name: '@deepseek-ai/dsh-command-feedback'
```

随附的 `dsh` 基础组合无条件挂载此命令；它没有配置，也不依赖持久化 goal 栈。Web 客户端通过命令适配器暴露该命令。无头模式、ACP（Agent Client Protocol）自动化和 JSON-RPC 不提供命令适配器，因此不会暴露它。

## 模型体验

### 用户 `/feedback` 采集

#### 模型看到的内容

无。斜杠输入、`feedback/record` 以及确认文本都不出现在模型请求中。反馈事件和注册表生命周期记录仅写入日志且不携带 `surfaceOp`，因此它们绝不会进入有序 surface、`deriveMessages()` 或系统提示词。在某个轮次中记录反馈不会改变该轮次剩余的请求。

#### Token 影响

无直接 token 影响。无论是已接受的条目还是用法错误，都不会在记录所在轮次或此后任何轮次增加模型 token。

#### KV Cache 影响

与模型请求路径无关。记录只追加到会话日志，不触碰已经可复用的请求前缀。本包贡献的任何内容都不会使缓存复用失效。

## 已知限制与暂缓工作

- **没有反馈检索或管理 surface**：可选的 OTel 插件仅将该事件用作共享触发器。本包不为 `feedback/record` 提供检索、聚合、分类或面向模型的工具。
- **没有结构化字段**：一条条目就是一个自由文本字符串，没有类别、严重程度或关联事件链接，因此无法在不重读文本的情况下按主题过滤反馈。
- **不支持修改或撤回**：会话日志是仅追加的，本包也不新增 tombstone，因此错误的条目会一直保留在记录中，只能由后续条目取代。
- **没有显式持久化屏障**：确认文本紧随追加而非 flush，因此紧临崩溃前记录的条目可能与其他未 flush 的尾部一同丢失。为反馈强制同步写盘并不值得；需要该保证的消费方可自行等待 `ctx.sessions.flush(session)`。
- **新会话上没有可见的确认**：Web 转录只在会话激活后渲染命令行，因此在仍为空白的新会话上执行 `/feedback` 会记录事件但不会显示确认行。发送首条消息后再记录反馈即可正常渲染。
- **随附的产品入口中只有 Web 使用此命令**：无头模式、ACP（Agent Client Protocol）自动化和 JSON-RPC 不提供命令适配器，因此 `/feedback` 在那里不可用。
