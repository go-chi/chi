# Agent Note: 用 eventsource-parser 替换 llm-deepseek 中手写的 SSE 解析器

Status: implemented
Archived: 2026-08-07

[English](2026-07-26-eventsource-parser-for-deepseek-sse.md) | 中文

## 问题

`packages/llm/llm-deepseek/src/sse.ts` 曾手写实现 SSE（Server-Sent Events）解析：一个流式 `TextDecoder`、按 `\r?\n\r?\n` 切分事件块、提取并拼接 `data:` 载荷、跳过注释与其他字段、`[DONE]` 哨兵、在未见哨兵即 EOF 时抛出 `STREAM_CLOSED` 错误，以及对最后一个未终结事件块的 flush。该文件约 67 行，另有约 108 行专属测试（`tests/sse.spec.ts`）重复验证 SSE 规范行为——UTF-8 字符被切分到多个分片、CRLF 处理、多条 `data:` 拼接、冒号后无空格——而这些行为，持续维护的解析器早已有保证。它唯一的消费方是 `adapter.ts`（`yield* translate(parseSse(response.body))`）。

这恰好是 `eventsource-parser` 负责的接口面：事实标准的 SSE 解析器（Vercel AI SDK 和 MCP SDK 都构建在它之上），零依赖，持续维护，并且已通过 `@modelcontextprotocol/sdk` 作为传递依赖出现在本仓库的 lockfile 中——因此直接采用它实际上不增加新的供应链接触面。

## 决策

`sse.ts` 将 SSE 分帧委托给 `eventsource-parser/stream` 的 `EventSourceParserStream`：`parseSse` 把响应 body 依次管道接入 `new TextDecoderStream()` 和 `new EventSourceParserStream()`，只保留 DeepSeek 协议垫层——逐个产出事件的 `data`，遇到 `[DONE]` 终止，流在未见哨兵时结束则抛出 `LlmError('STREAM_CLOSED')`。所需的全部内置能力（`TextDecoderStream`、`pipeThrough`、可异步迭代的 `ReadableStream`）在 Node ^22.19 引擎下限即已存在。规范符合性测试已删除；`tests/sse.spec.ts` 只固定 `[DONE]`/`STREAM_CLOSED`/EOF 契约。`eventsource-parser` 是 `llm-deepseek` 继 schemastery 之后的第二个运行时依赖。曾把该适配器标为「手写 fetch + SSE 解析」的[孪生适配器 Agent Note](../architecture/2026-06-13-twin-llm-adapters.md)与 `dsh-llm` JSDoc，现在将其描述为直接 fetch 加库分帧的 SSE。

该库还会剥离开头的 BOM（手写解析器在 BOM 之后会无法匹配 `data:`），并提供手写解析器缺少的 `maxBufferSize` 加固能力。

## 曾考虑的替代方案

- **保留手写解析器。** 依据[孪生适配器决策](../architecture/2026-06-13-twin-llm-adapters.md)，这一选择有辩护余地：该适配器有意作为 pi-ai 适配器的手写设计验证孪生体。但那份 Agent Note 起支撑作用的区分在于「自行持有 fetch/translate 内部实现」与「委托给完整的提供方 SDK」；一个约 700 字节的 SSE 微型解析器属于传输层管道，不是被验证的设计本身。孪生适配器 Agent Note 现已明确写出这一解读。
- **改用 `createParser({onEvent})` 回调 API 而非流。** 配合手动的 `TextDecoder` 循环可以工作，但 `pipeThrough` 组合方式能删除更多手写代码。

## 后果

- 剩下的垫层只编码 DeepSeek 的 `[DONE]`/`STREAM_CLOSED` 协议；SSE 分帧边界情形属于 eventsource-parser 的契约，不再在这里重复验证。
- 放弃了一处有意为之的健壮性偏离：手写解析器会 flush 缺少终结空行的最后一个事件块，因此末尾的 `data: [DONE]` 即使没有 `\n\n` 也仍产出 DONE。eventsource-parser 严格遵循规范，只在空行处分发事件，所以这种形态现在是 `STREAM_CLOSED`。真实提供方和 `dsh-llm-mock-server` 总是正确终结事件——该 flush 只是健壮性上的锦上添花，并非实际观测到的提供方形态——`tests/sse.spec.ts` 固定了对该尾部的新截断判定。
- 孪生适配器有文档记录的「手写」身份收窄到 fetch/translate 内部实现；孪生适配器 Agent Note 在同一次变更中更新，而不是让声明陈旧下去。
