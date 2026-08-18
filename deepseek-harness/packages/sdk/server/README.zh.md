# @deepseek-ai/dsh-sdk-jsonrpc-server

[English](README.md) | 中文

`jsonrpc` 插件通过 stdio 提供以换行符分隔的 JSON-RPC，使进程外 SDK 客户端能够驱动 harness agent（智能体）。[`HarnessSdkJsonRpcServer`](src/server.ts) 负责协议方法和通知；传输与具名协议类型位于 [`dsh-sdk-protocol`](../protocol/README.md)，与客户端 SDK 共享；[`jsonrpc-demo`](../../examples/jsonrpc-demo/README.md) 提供外围的 `cordis.yml` 应用。

## 组装

`inject: ['agents']`。服务器按 `sessionId` 获取或创建一个 agent。只有服务对生命周期建立快照时记录的 `local` 标志为 true，服务器才会转发 subagent 完成事件；提供方名称、子级 id 和持久化谱系均不能证明本地性。已注册的适配器优先；尚无适配器负责的 `deepseek-official` 路由会挂载 `dsh-llm-deepseek`，任何其他尚无适配器负责的提供方都会导致初始化失败。其他能力由外围 `cordis.yml` 提供。

## 配置

`maxTokensAsSuccess` 默认为 `false`，且只影响 `subagent.finished` 上由部署映射的状态；根会话提示词没有提示词级状态。`JsonRpcConfig.input`、`output` 和 `exit` 是仅供运行时使用的传输钩子；生产环境使用进程 stdio 和 `process.exit`。

## stdout 即协议

Stdout 只承载 JSON-RPC 帧。部署不得组合 stdout logger；诊断应写入 stderr。

## 关闭与退出语义

插件响应 `shutdown`，刷新响应并 dispose（资源释放）根上下文，使 SDK 持有的 agent、订阅和持久化达到完全停稳，然后以代码 0 退出。EOF 和信号退出由 app bin 处理，后者也会 dispose 根上下文。仅卸载此插件会停止服务，但不会退出进程。

## 协议说明

`initialize.serverInfo.name` 的协议稳定值为 `deepseek-harness-sdk-runtime`。可选的正整数 `initialize.maxTokens` 会成为每个 SDK 创建的 agent 及其进程内后代的请求输出上限；非法值会使初始化失败，省略时则不发送 SDK 上限，并应用所选适配器或提供方路由的默认值。`session/prompt` 将一条带标识的用户消息排入队列，并立即返回 `{ messageId }`。服务器将每个持久事实作为 `session.event` 流式发出，并将整个 agent 生命周期的每次状态转换作为 `session.status` 发出；它不会把某条助手消息或 `turn/end` 归属于该提示词。同一会话上的独立请求可以继续排入更多工作。持久化根目录和 persona 由 `cordis.yml` 提供。

## 模型体验

### SDK 用户消息

#### 模型看到的内容

对于每个已接受的 `session/prompt`，对话模型会将调用方提供的 `contentBlocks` 原样作为该 SDK 会话中的一条用户消息接收。此包不会添加系统提示词文本或工具 schema；这些内容来自外围 `cordis.yml` 中的插件。

#### Token 影响

依数据而定的用户消息 token 会进入保留的会话历史，并在后续轮次中重复发送，直至另一个包将其压缩（compaction）。JSON-RPC 帧、会话通知和服务器内部记录不会增加模型上下文 token。

#### KV Cache 影响

仅追加；新可见内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

## 已知限制与暂缓事项

- **协议没有逐会话关闭或提示词取消方法**：SDK 创建的 agent 会一直存活到进程关闭。
- **没有逐提示词结果**：`MessageId` 只标识 inbox 准入；拥有自动化活动区间的客户端必须自行定义并观察该区间。
- **stdout 纯净性由部署保证**：外围配置仍可能加载 stdout logger 并破坏 JSON-RPC 通道；此插件不会检查或否决同级 logger。
- **自动挂载适配器仅支持 DeepSeek**：`initialize` 可以复用任何预先注册的模型适配器，但唯一的回退行为是挂载 `dsh-llm-deepseek`。
