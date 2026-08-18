# Agent Note: 移除未被消费的 LLM 组装便捷接口

Status: implemented
Archived: 2026-07-26

[English](2026-06-20-drop-unconsumed-llm-assembled-surfaces.md) | 中文

## 问题

`LlmService`（[packages/llm/llm/src/index.ts](../../../../packages/llm/llm/src/index.ts)）在模型之上暴露了三个调用接口：

- `stream()`：原始 `StreamChunk`，通过 `llm/stream` waterfall（瀑布式事件）分发。
- `streamBlocks()`：一个「便捷视图」，将分片送入 `BlockAssembler` 并按流顺序产出已组装的 `ContentBlock`（[index.ts:137-144](../../../../packages/llm/llm/src/index.ts)）。
- `generate()`：一个完整组装的 `GenerateResult`，通过第二条 `llm/generate` waterfall 分发（[index.ts:151-157](../../../../packages/llm/llm/src/index.ts)）。

LLM（大语言模型）服务唯一的生产消费方是 agent loop（智能体循环），它只使用 `stream()`：将原始分片送入自己的 `BlockAssembler`，以便在并行组装的同时记录分片，保证回放保真度（[packages/core/agent-loop/src/loop.ts](../../../../packages/core/agent-loop/src/loop.ts)，`ctx.llm.stream(req)` 步骤）。在 `packages/*/src` 和 `examples/*/src` 中 grep `streamBlocks` 与 `ctx.llm.generate`，找不到任何生产调用方。仅有的引用来自服务方法定义、文档和测试；适配器测试用 `generate()` 作为便捷驱动，但它们完全可以通过同一个 assembler 辅助函数手动消费 `stream()`，无需为此保留一个公开的生产 API。

这属于[删除可变会话 summary](2026-06-19-drop-mutable-session-summary.md) 的同类模式：带有受测契约的组装视图 API，由测试而非生产代码消费。它们是为不关心 token 级增量的消费方推测性构建的，但唯一的真实消费方恰恰关心增量，以便持久化高保真重放数据。

`streamBlocks()` 拖带了 `BlockAssembler` 的一块专用逻辑：`flushReady()` 与 `flushRemaining()`（[packages/llm/llm/src/assembler.ts:138-168](../../../../packages/llm/llm/src/assembler.ts)）以及 `flushed` 游标字段，仅为支持按序增量产出而存在。`generate()` 拖带了 `GenerateResult`、`BlockAssembler.result()` 以及 `llm/generate` waterfall——在同一底层流之上的第二个拦截面。agent loop 对 assembler 的使用仅限于 `push()` / `message()` / `usage` / `finish`，不涉及流式 flush 或一次性服务组装。

## 决策

`stream()` 是唯一的公开 LLM 调用接口。移除 `streamBlocks`、`generate`、其事件/结果类型，以及仅被该路径使用的 assembler 辅助方法。适配器测试通过本地辅助函数对公开流进行组装；`BlockAssembler` 仅保留有生产消费方的操作。

## 曾考虑的替代方案

**保留 `generate()` 作为仅供测试的便捷方法**：否决。适配器测试通过共享 assembler 手动消费 `stream()`，走的是与生产完全相同的流式路径；一个唯一调用方只有测试的公开方法，正是 [drop-mutable-summary 先例](2026-06-19-drop-mutable-session-summary.md)所淘汰的死接口形态。未来如果有消费方需要不带增量的组装块，届时再为该消费方引入一个聚焦的辅助方法。

## 验证

`streamBlocks`、`generate`、`llm/generate` 及仅供它们使用的 assembler 辅助函数均已移除，且未产生新的无用导出；两个真实适配器都通过 `stream()` 和共享 assembler 接受测试；循环行为保持一致（ACP（Agent Client Protocol）快照预期输出未变）；README、架构文档和模块文档也不再提及已删除表面。

## 后果

- **从一个核心词汇包中移除了公开方法。** 未来如果有插件需要不带增量的组装块，它需要直接调用 `stream()` 并使用 `BlockAssembler`，或在有真实消费方时重新引入一个聚焦的辅助方法。鉴于预发布阶段「基础优先于预设未来」的立场（[AGENTS.md](../../../../AGENTS.md)），现在正是裁剪仅供测试的公开接口的合适时机。
- **适配器测试变得更显式。** 它们失去了便捷的 `generate()` 包装层，但这是有益的压力：测试走的是与生产相同的流式路径。
- **waterfall 使用者失去 `llm/generate`。** 不存在生产监听者。未来的缓存/重试/日志插件应包装 `llm/stream`，它仍然是唯一的提供方调用路径。

改动规模不大，但它从 LLM 包中干净地移除了预设的接口面积，为生产和测试留下唯一一份模型调用契约。
