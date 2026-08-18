# Agent Note: 移除未被消费的 `llm/adapter-change` 事件

Status: implemented
Archived: 2026-07-26

[English](2026-06-20-drop-unconsumed-llm-adapter-change-event.md) | 中文

## 问题

`LlmService.registerAdapter()` 在注册和 dispose（资源释放）时发出 `llm/adapter-change` 事件（[packages/llm/llm/src/index.ts](../../../../packages/llm/llm/src/index.ts)）。在 `packages/*/src` 和 `examples/*/src` 中搜索 `llm/adapter-change`，只能找到声明、emit 站点、文档和测试；没有任何生产环境的监听器订阅它。

这与 `tools/change` 和 `system-prompt/change` 不同。如今这两个事件同样没有消费方，但它们有望成为未来实时工具/提示词 UI 的注册表变更信号。LLM（大语言模型）适配器注册更像是启动时的实现细节：适配器不是用户可见的选项面板，真正的模型调用拦截 seam 是 `llm/stream`。保留一个没有监听器的适配器变更事件，只是在更小范围内重复[删除无用 summary](2026-06-19-drop-mutable-session-summary.md) 的模式。

这个事件并非零成本。`registerAdapter()` 在发出 `llm/adapter-change` 之前先 yield 回滚 disposer，这样抛出异常的监听器会回退变更而非泄漏适配器条目；包内还有针对该监听器抛出路径的测试。这种防御性排序保护的是一个只有测试才能触发的失败模式。

## 决策

只移除 `llm/adapter-change`：包括 `dsh-llm` 的 `interface Events` 中的声明、`ctx.emit('llm/adapter-change')` 调用，以及 `LlmService.registerAdapter` JSDoc 中“在注册和释放时发出 `llm/adapter-change`”的句子。`registerAdapter()` 的效应生成器为 HMR（热模块替换）/释放保留变更与回滚 disposer，但移除仅因该事件而存在的监听器抛错回滚顺序。适配器 disposer 测试断言返回的 disposer 会移除适配器，不再订阅事件；监听器抛错回滚测试则随其测试对象一起消失。[docs/architecture.md](../../../../docs/architecture.md) 和 [packages/llm/llm/README.md](../../../../packages/llm/llm/README.md) 中的事件分类也在同一变更中更新。

## 曾考虑的替代方案

### 为什么不移除所有注册表变更事件？

由注册表通告变更的微内核是一种一致的约定。当 UI 能够实时刷新可用工具或提示词章节时，`tools/change` 和 `system-prompt/change` 可能会有用。本 Agent Note（agent 决策记录）在存在合理用户侧消费方的位置保留该约定，只删除当前及可能的未来消费方都不明确的适配器变更事件。

如果将来需要 LLM 适配器浏览器或动态模型选择器用到此信号，届时再连同消费方一起重新引入，并提供比「something changed」更清晰的 payload。

## 验证

`llm/adapter-change` 及其 emit 已消失，重新生成的 Cordis 目录保持新鲜；HMR 安全性仍成立（释放贡献该适配器的 fiber 会移除它）；`tools/change` 和 `system-prompt/change` 仍有文档与测试；ACP（Agent Client Protocol）快照和无密钥 Headless Loader 冒烟则固定了未变的生产路径。

## 后果

- **移除一个已文档化的 emit 事件属于公开接口变更。** 它出现在分类体系表中，读起来像有意设计的 API。但「已声明且已发出」不等于「已被消费」——这与移除可变 summary 时的判断依据相同。分类体系表在同一个变更中更新，因此文档不会漂移。
- **注册表变更约定变得不均匀。** 这是可接受的，因为 LLM 适配器注册与工具或提示词段落不是同一层面的面向用户概念。不均匀但诚实，胜过统一但无用。

这是一个小裁剪，但它退役了一条守护着并不存在的消费方的正确性不变式。
