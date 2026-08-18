# Agent Note: 裁剪无生产者的词汇变体（块缓存提示、`agent` 消息来源、`continuation` 轮次触发器）

Status: implemented
Archived: 2026-07-26

[English](2026-07-04-prune-producerless-vocabulary-variants.md) | 中文

## 问题

可合并扩展的词汇映射表设计上通过声明合并来增长，代码库已在 `TurnEndReasonMap`（`packages/core/session/src/types.ts`）上明确了准入策略：像 `refusal` 这样的变体「在适配器或循环首次发出它之前，有意不纳入」。三个已声明的词汇项违反了该策略——每个都既无生产者也无消费方，其中两个甚至没有测试：

- **`TextBlock`/`ToolResultBlock` 上的 `CacheHint` 及其 `cache?: CacheHint` 块字段**（`packages/llm/llm/src/types.ts`；图像块曾有第三个此类字段，已随图像块一同移除——参见[删除图像 Agent Note（agent 决策记录）](2026-07-04-drop-image-content-block.md)）。任何地方都没有构造带 `cache:` 的块——src、测试和文档粘贴均为空——两个适配器也都不读取 `.cache`：DeepSeek 的提示词缓存是自动的，因此适配器会从响应中映射出 `prompt_cache_hit_tokens`，却从不向请求中发送 hint。这是没有任何提供方能够遵守的 Anthropic 风格 `cache_control` 表面。
- **`MessageSourceMap.agent`**（`{ kind: 'agent'; agentId: string }`，同一文件）。零个构造点，包括测试在内。它预期的生产者在实现时并未使用它：subagent 后端将父级的提示词发送给子级时不带 `source`，因此记录为 `{ kind: 'user' }`，通用信封渲染器在插值 `source.kind` 时也从未对其做路由。
- **`TurnTriggerMap.continuation`**（`packages/core/session/src/types.ts`）。agent loop（智能体循环）在结构上不可能发出它——continuation 发生在一个轮次*内部*作为后续步骤，而非作为新轮次——循环只构造 `message` 和 `injection` 触发器。唯一的写入者是一个手工构建的测试 fixture（测试前置数据），它只需要一个任意的非消息触发器（`packages/support/llm-replay/tests/llm-replay.spec.ts`），`injection` 触发器同样满足需求；唯一的生产环境触发器读取方 ACP（Agent Client Protocol）桥接层只过滤 `kind === 'message'`。

## 决策

`CacheHint`、其 `cache?` 块字段、`agent` 消息来源变体和 `continuation` 轮次触发器变体均已删除：已发布词汇不再携带它们。llm-replay fixture 使用 `injection` 触发器（任何非 `message` 触发器都能满足其用途）。[core.md](../../../../docs/core-data-structures/core.md) 和 [session.md](../../../../docs/core-data-structures/session.md) 中的 type-equiv 粘贴与裁剪后的 map 匹配——两个符号仍保留在 `scripts/type-equiv.manifest.json` 中的行，因为每个 map 都只是少了一个成员而继续存在——并且[内容块词汇 Agent Note](../architecture/2026-06-11-content-block-vocabulary.md)的后果按照 [implemented/AGENTS.md](../AGENTS.md)，将 cache hint 记录为由生产者门控，而不是已有归属。

每个变体在获得真正的生产者之日回归，这正是映射表设计的增长方式：缓存功能连同传输它的适配器一起重新添加 `cache`；subagent 归属连同打标的后端和路由它的消费方一起重新添加 `agent`；真正启动新轮次的自动续行功能连同发出它的插件一起重新添加 `continuation`。

## 曾考虑的替代方案

### 为什么不保留它们？

[内容块词汇 Agent Note](../architecture/2026-06-11-content-block-vocabulary.md)曾把“cache hint……有了归属”列为设计后果，预留槽位也确实能表明意图。但空槽位是每个实现和消费方都必须考虑的契约表面（我的适配器是否必须遵守 `cache`？我的 renderer 是否必须路由 `agent` 来源？），而相邻 map 自身的 JSDoc 已经拒绝“无 emitter 先预留”——`refusal` 和 `max_turn_requests` 被点名为*首次有内容发出它们时*再添加的变体，而不是提前声明。让已经声明但无用的变体遵守同一标准，才能使词汇真正有意义：只要它位于 map 中，就必须有内容生产它。

## 验证

对 `CacheHint`、`agent` 消息来源拼写和 `continuation` 触发器拼写运行 `rg`，只会返回 Agent Note 记录（本文，以及[删除图像 Agent Note](2026-07-04-drop-image-content-block.md)对图像块自身 `cache` 字段的说明）；llm-replay fixture 使用 `injection` 触发器断言相同的重放行为；核心数据结构粘贴和 type-equiv 清单保持同步。

## 后果

操作行为没有变化——原本就没有内容能够构造这些值。镜像事件移除（[边界镜像 Agent Note](2026-06-20-remove-agent-boundary-mirror-events.md)、[流分片 Agent Note](2026-07-02-remove-stream-chunk-mirror.md)）只触及瞬态 `agent/*` 事件，从不触及持久词汇，因此不存在冲突。其他位置已经遵守准入策略：`rejected`、`prompt/blocked` 和 `hook/invoked`/`hook/result` 都有实时生产者——本 Agent Note 将同一门槛扩展到缺少生产者的三个变体。图像块自身的 `cache?` 字段归属[删除图像 Agent Note](2026-07-04-drop-image-content-block.md)，后者将其与该块一同移除；本 Agent Note 覆盖剩余块类型上的两个字段。
