# @deepseek-ai/dsh-sdk-client

[English](README.md) | 中文

以子进程方式驱动 DeepSeek Harness 运行时、走 stdio JSON-RPC 的 TypeScript 客户端 SDK——[Python SDK](../../../python/README.md)（`deepseek-harness`）的设计孪生，共享同一个运行时对端、协议与分层：`DeepSeekHarness` 是高层自有运行 API，`HarnessClient` 是低层协议客户端。包（package）根枚举消费方接口：两层客户端、面向调用方的类型和 `JsonRpcResponseError`；源模块、规范化辅助函数与订阅投递机制不供消费方导入。纯库：不在任何 Cordis 上下文注册；它所 spawn 的运行时进程是一个完整 harness，其组成由自己的 `cordis.yml` 决定。

与 Python SDK 不同，启动规格完全显式（`command`/`args`）：本包面向仓库近旁的 TypeScript 消费方，包括 [`dsh-subagent-dsh-sdk`](../../subagent/subagent-dsh-sdk/README.md) 后端和自动化；它们知道自己要启动哪个运行时。捆绑运行时解析（寻找打包可执行文件）仍归 Python 发行版负责。

## DeepSeekHarness

```ts
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'

await using harness = new DeepSeekHarness({
  launch: { command: 'node', args: ['lib/bin.js', 'cordis.yml'] },
  provider: 'deepseek-official',
  model: 'deepseek-v4-flash',
  maxTokens: 49_152,
})
const result = await harness.run('say hi')
console.log(result.finalResponse)
```

子进程在首次使用时惰性启动，并在多次 `run()` 之间持续归实例所有；必须 `close()`（或 `await using`），子进程才总能被回收。`start()` 记忆化 `initialize` 握手（工作区 cwd——在通过协议传输之前解析为绝对路径——加 provider/model 路由和可选的正整数 `maxTokens` 输出上限）；握手失败会回收运行时并换入全新客户端，后续调用用新子进程重试（直到终结性的 `close()`）。该上限作用于根 agent（智能体）的每次请求，并由进程内后代继承；压缩（compaction）插件单独持有摘要上限。`session(id?)` 打开具名或全新的会话句柄。

`run(input, { sessionId?, onNotification? })` 拥有一个活动区间：它将提示词排入队列，等待其 `MessageId` 出现在持久的 `agent/inbox/spliced` 回执中，然后持续收集到整个 agent 下一次进入 `idle`。它返回 `RunResult { sessionId, finalResponse, events, notifications }`。`finalResponse` 是该区间内根会话最后提交的助手文本，并非因果上归属于该提示词的响应；steering（中途引导）、注入的上下文和其他排队工作都可能在 idle 前参与其中。`events` 包含根会话事件，`notifications` 还包含通过 `subagent.started` 发现的后代，均按协议传输顺序排列。结果不携带提示词级状态或轮次原因。传输丢失、超时和协议违例会导致 Promise 被拒绝；模型结果仍可在事件流中观察，但不会归属于某一输入。

## HarnessClient

自有运行 API 之下的协议客户端：显式 `start()`/`initialize()`/`prompt()`/`request()`/`close()`，外加通知订阅。`prompt()` 在运行时接受排队消息后立即返回该消息的 ID，绝不等待 agent 活动。`subscribe(filter?)` 返回 `NotificationSubscription`（可等待的 `next()`、非阻塞 `tryNext()`、异步迭代）；`subscribeSessionTree(id)` 把范围限定到一个会话及从 `subagent.started` 血缘边发现的后代——运行时对上下文内每个会话都发通知，范围限定在客户端完成，与 Python SDK 完全一致。本包导出有明确类型的错误：`JsonRpcResponseError`（协议错误响应，保留 code/data）、`RequestTimeoutError`（配置的时限已到）、`SdkProtocolError`（响应超出文档化协议）、`TransportClosedError`（运行时已消失——消息携带退出码与有界 stderr 尾部）。

`close()` 先请求协议 `shutdown`（受 `shutdownTimeoutMs` 约束，默认 1000 毫秒），然后走 stdin-EOF → SIGTERM → SIGKILL 阶梯（`disposeEofGraceMs` 默认 6000，`disposeGraceMs` 默认 3000）直到进程真正退出。该阶梯为本客户端私有：它运行在任何 harness 上下文之外，无法搭乘 [`dsh-subprocess`](../../subprocess/README.md) 服务——即该 seam 所记录的 SDK 托管传输例外。幂等，已关闭的客户端拒绝复用。

`HarnessClientOptions.env` 给定时整体替换子进程环境（`undefined` 原样继承父进程环境）；凭据策略归调用方——`dsh-subprocess` 的 `scrubbedParentEnv` 是面向隔离启动的共享擦除基底。

## 模型体验

无，因为这是一个客户端进程库；模型运行在 spawn 出的运行时中，其体验由该运行时的 `cordis.yml` 所组合的插件决定。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **无捆绑运行时解析**——调用方显式指定运行时可执行文件；打包可执行文件的发现留在 Python 侧，直到出现 TypeScript 发行版消费方。
- **无轮次中取消**——协议层没有提示词取消方法；放弃轮次意味着关闭运行时（见协议的 [已知限制](../protocol/README.md)）。
- **没有逐提示词结果或取消**——低层 `prompt()` 只返回入队回执；高层 `run()` 负责从回执收集到 idle，放弃该过程意味着关闭运行时。
- **客户端→服务端通知与服务端→客户端请求**在协议两端都未实现；传输层为未来审批流保留了承载能力。
