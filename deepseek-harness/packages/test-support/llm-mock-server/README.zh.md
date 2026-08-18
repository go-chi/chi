# `@deepseek-ai/dsh-llm-mock-server`

[English](README.md) | 中文

可编脚本的 OpenAI 兼容 HTTP／SSE（Server-Sent Events）服务器，用于在无提供方密钥的情况下测试真实 LLM（大语言模型）适配器、agent loop（智能体循环）和恢复策略。它接受 `POST /chat/completions` 和 `POST /v1/chat/completions`；每个已接受请求按到达顺序消费一个已配置行为。无效的请求方法、路径、Bearer token 和 JSON 不会消费脚本条目。

库入口导出 `startMockLlmServer(options)`、行为类型和遥测（telemetry）类型、默认随机压力权重、Node 定时器允许的上限，以及带有绑定 `baseURL`、自动生成或显式配置 `randomSeed`、已捕获请求和幂等 `close()` 的运行句柄。关闭会强制终止停滞连接。

## 独立使用

从本仓库运行源入口：

```sh
pnpm run mock:llm -- \
  --port 8000 \
  --api-key mock-key \
  --sequence partial_disconnect,success \
  --partial-text "discard this half"
```

将发布的 DeepSeek 适配器指向服务器；它会将 `/chat/completions` 追加到已配置 base：

```sh
DEEPSEEK_BASE_URL=http://127.0.0.1:8000/v1 \
DEEPSEEK_API_KEY=mock-key \
pnpm dsh --profile headless "test provider recovery"
```

仓库脚本将 JSONL 写入 stdout：`ready` 记录携带以 `/v1` 结尾的基础 URL 和随机种子，后续请求/结果记录同时命名脚本行为和实际选中的具体行为。这个私有支持包不公开可安装的二进制命令。

## 行为脚本

`--sequence` 是逗号分隔的 FIFO。耗尽时返回结构化 HTTP 500；`--repeat-last` 显式重用最后一项。

| 行为 | 协议结果 |
|---|---|
| `connection_reset` | 在发送 HTTP 标头前销毁 socket |
| `stream_disconnect` | 发送 SSE 标头，然后在第一个事件前重置连接 |
| `partial_disconnect` | 发送文本增量，然后重置 socket |
| `stall` | 发送 SSE header，并保持空闲，直到客户端／服务器取消 |
| `empty` | 发送有效的无内容 stop 和 `[DONE]` |
| `empty_body` / `stream_eof` / `partial_eof` | 正常结束，但缺少必需的 `[DONE]` 边界 |
| `malformed_json` / `malformed_event` | 发送无效 SSE JSON 或无效提供方分片形态 |
| `rate_limit` / `server_error` / `service_unavailable` | 返回面向重试的 429/500/503 JSON 错误 |
| `auth_error` / `invalid_request` / `context_overflow` / `quota_exceeded` | 返回终止性错误或需要单独恢复的提供方错误 |
| `success` / `slow_success` / `reasoning_success` | 流式发送完整文本响应，可选延迟或先发送 reasoning |
| `tool_call_success` / `max_tokens` | 以工具调用或结束原因 `length` 完成 |
| `wrong_content_type` | 以 `application/json` 内容类型发送有效 SSE 正文 |
| `random` | 按带权重的种子随机选择具体请求行为 |

`connection_refused` 只能在 CLI 中使用，且必须是第一个条目。它会延迟绑定调用方指定的非零端口，因此 `--listen-delay-ms` 期间的请求会收到真实 TCP 拒绝；其余条目在 listener 启动后开始。

## 随机模式

使用重复 `random` 条目执行开放式混合运行：

```sh
pnpm run mock:llm -- \
  --port 8000 \
  --sequence random \
  --repeat-last \
  --seed 42 \
  --random-weights 'success=60,slow_success=10,connection_reset=5,stream_disconnect=5,partial_disconnect=10,empty=5,server_error=5'
```

省略 `--seed` 会生成种子，并在 `ready` 记录中打印。`--random-weights` 接受非负的相对 `behavior=weight` 条目，并要求至少一个正权重具体行为。导出默认值是一个成功占主导的压力分布，包含 reset、disconnect、部分输出、空完成、stall、429/5xx、干净截断和格式错误的 JSON；它用于施加测试压力，而非估计生产事故频率。`connection_refused` 被排除，因为已绑定的请求处理器无法产生真实拒绝。

随机权重包含 `stall` 时，为待测客户端配置较短的流空闲超时，使场景及时结束。

## 时序与内容控制

CLI 公开 `--success-text`、`--partial-text`、`--reasoning-text`、`--chunk-size`、`--chunk-delay-ms`、`--disconnect-delay-ms`、`--retry-after-ms`、`--request-id`、`--tool-name` 和 `--tool-arguments`。毫秒延迟是 Node timer 范围内的有界整数；`retryAfterMs` 还必须为正数。库接受相同的 camel-case 选项。可选的 `apiKey` 会精确验证 `Authorization: Bearer <token>`；省略时接受任何 token。

## 模型体验

无。该测试服务器替代提供方协议行为，而不调用真实模型。

#### KV Cache 影响

无；请求在本地终止，绝不会到达提供方缓存。

## 已知限制与暂缓事项

- **随机权重建模测试压力，而非生产事故频率**：需要环境专用分布的调用方必须提供已测量权重，并记录发出的种子。
- **请求脚本按到达顺序执行**：并发调用方共享一个游标，因此确定性的每会话故障分配需要独立服务器实例。
- **真实连接拒绝发生在监听器生命周期阶段**：CLI 延迟必须与客户端尝试重叠；请求级随机选择只能重置已接受的连接。
