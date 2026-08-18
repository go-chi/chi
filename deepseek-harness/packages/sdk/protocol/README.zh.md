# @deepseek-ai/dsh-sdk-protocol

[English](README.md) | 中文

DeepSeek Harness SDK 运行时的共享协议格式（wire format）：一个按换行分帧的 JSON-RPC 2.0 传输类，加上协议两端共同使用的具名请求、结果与通知类型。包根枚举协议消费方接口；源模块不支持深层导入。服务端是 [`dsh-sdk-jsonrpc-server`](../server/README.md) 插件；客户端是 [`dsh-sdk-client`](../client/README.md)（TypeScript）与 [Python SDK](../../../python/README.md)（后者复现这些结构但不导入它们）。纯库——无插件、无 Config、无注册。

## 传输

`JsonRpcLineTransport` 在调用方持有的字节流上为 JSON-RPC 2.0 分帧，每行一个紧凑 JSON 帧、以 `\n` 结尾。带 `id` 与 `method` 的帧是请求，仅 `id` 是响应，仅 `method` 是通知；非法 JSON 行被忽略。`start()` 挂接流监听器，`close()` 移除监听器并拒绝挂起请求，但不销毁流。缺失请求处理器时应答 `-32601`；处理器返回的 Promise 被拒绝时，则应答携带错误消息的 `-32603`。错误响应会以 `JsonRpcResponseError` 拒绝挂起的 `request()` Promise，并保留协议格式中的 `code` 与可选 `data`。`JsonRpcTransportPeer` 是服务器类据以进行类型声明的出站接口（request/notify）。

## 协议类型

`types.ts` 为 `HarnessSdkJsonRpcServer` 所服务协议的每个载荷命名：

| 方向 | 方法 | 类型 |
|---|---|---|
| client→server | `initialize` | `InitializeParams` → `InitializeResult` |
| client→server | `session/prompt` | `SessionPromptParams` → `SessionPromptResult`（持久入队回执） |
| client→server | `shutdown` | 无参数 → `{}` |
| server→client | `session.event` | `SessionEventNotification`（运行时内每个会话，不过滤） |
| server→client | `session.status` | `SessionStatusNotification`（整个 agent（智能体）的 `running`/`idle` 转换） |
| server→client | `subagent.started` | `SubagentStartedNotification` |
| server→client | `subagent.finished` | `SubagentFinishedNotification`（仅进程内运行） |

`HarnessSdkRequestMap` 与 `HarnessSdkNotificationMap` 按方法名索引这些类型。`SessionPromptResult.messageId` 标识已排队的 `UserMessage`；它不标识后续的助手消息、轮次结束或提示词结果。客户端根据自己对活动区间的所有权，组合持续开放的 `session.event` 流与 agent 级的 `session.status`。`SubagentFinishedNotification.lastAssistantMessage` 包含子 agent 最后一条非空 assistant 消息；若不存在这类消息，则包含其累积的 assistant 文本；子 agent 两种输出均未产生时，该字段缺省。`InitializeParams.maxTokens` 是可选的正的安全整数，用于限制 SDK 创建的 agent 及其进程内后代的每次对话模型输出；省略时会应用所选适配器的确切模型默认值，否则提供方行为保持不变。通知载荷类型依赖 `SessionEvent`（`dsh-session`）、`ContentBlock`（`dsh-llm`）与 `SubagentStopReason`（`dsh-subagent`）——协议以完整会话日志封套进行流式传输，因此会话词汇是协议格式约定的一部分。`serverInfo.name` 的协议值固定为 `deepseek-harness-sdk-runtime`。

## 模型体验

无，因为此包定义面向客户端的协议格式；模型可见接口属于组合在对外服务入口 [`dsh-sdk-jsonrpc-server`](../server/README.md) 后方的运行时插件。

#### KV Cache 影响

无；此包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **无协议版本协商**——握手只携带 `serverInfo.version`（`0.0.1`，客户端不校验）；处于预发布阶段，无兼容承诺。
- **无取消与会话关闭方法**——客户端放弃轮次的方式是关闭运行时进程；见 [`dsh-sdk-jsonrpc-server` README](../server/README.md)。
- **server→client 请求是未使用的功能**——传输层支持，但服务器从不发送；Python SDK 的应答接口为未来审批流程预留。
