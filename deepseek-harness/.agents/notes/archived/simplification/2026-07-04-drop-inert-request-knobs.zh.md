# Agent Note: 移除 `GenerateOptions.prefill` 与 `ToolSchema.strict`——无端到端可用路径的请求旋钮

Status: implemented
Archived: 2026-07-26

[English](2026-07-04-drop-inert-request-knobs.md) | 中文

## 问题

两个请求契约旋钮贯穿了整条请求流水线，却都无法产生任何效果：

- **`prefill`**（`packages/llm/llm/src/types.ts`）没有生产级的 setter：agent loop（智能体循环）组装的是 `model`/`system`/`tools`/`messages` 加 `sessionId`/`signal`，上下文压缩（context compaction）后端只追加 `maxTokens`；而且两个适配器都拒绝它：`packages/llm/llm-deepseek/src/serialize.ts` 和 `packages/llm/llm-pi-ai/src/adapter.ts` 各自在 `prefill` 非 undefined 时抛出 `LlmError('UNSUPPORTED')`。该字段的全部可观测行为就是两个 throw，各由一条适配器测试固定。DeepSeek 的 chat-prefix completion 是一个 Beta 功能，运行在两个适配器都未指向的 base URL 上。
- **`strict`**（`ToolSchema`，同一文件）穿过了 `DefineToolOptions`/`defineTool`（`packages/core/tools/src/schema.ts`）、注册表的 `schemas()` 允许列表（`packages/core/tools/src/index.ts`）、deepseek 协议格式（wire format）映射（`packages/llm/llm-deepseek/src/serialize.ts`，其 wire-type 注释记录了 strict 模式需要适配器未使用的 `/beta` base URL）、`packages/llm/llm-pi-ai/src/adapter.ts` 中的逐工具 payload 修补逻辑，以及 tool-catalog 渲染器（`scripts/gen-tool-catalog.ts`）中的条件 `Strict:` 行。没有任何已发布的工具设置过它——在所有 `tool-*` 包的 src 和 `examples/` 中执行 `rg` 搜索，`strict:` 的生产者为零；唯一的 setter 出现在 dsh-tools 单元测试中。

两个旋钮在适配器间是对称的，因此移除操作将它们从两个孪生适配器中一并剥离——[孪生适配器设计](../architecture/2026-06-13-twin-llm-adapters.md)不受影响。

## 决策

- 从 `GenerateOptions` 中移除 `prefill`，同时移除两个适配器的 UNSUPPORTED 守卫、固定抛错行为的测试、[core.md](../../../../docs/core-data-structures/core.md) 中的粘贴行，以及记录该拒绝行为的适配器 README 表格行。实操手册中的 UNSUPPORTED 指导（[adding-an-llm-adapter.md](../../../../docs/cookbook/adding-an-llm-adapter.md)）改为通用表述规则——提供方无法遵守的 `GenerateOptions` 字段应抛出 `LlmError(..., 'UNSUPPORTED')`——而不再以 prefill 为例。[内容块词汇 Agent Note（agent 决策记录）](../architecture/2026-06-11-content-block-vocabulary.md)的后果按照 [implemented/AGENTS.md](../AGENTS.md)，将 prefill 记录为由生产者门控，而不是已有归属。
- 从 `ToolSchema`、`DefineToolOptions`、`defineTool`、`schemas()` 允许列表、deepseek 序列化分支及其 wire-type 字段，以及工具目录渲染器的 `Strict:` 行中移除 `strict`。pi-ai 的 payload 修补逻辑简化为对 pi-ai 自身逐工具 strict 默认值的无条件清除（pi-ai 在每个序列化的工具上打 `strict: false`；手写的孪生适配器不发送此字段，因此清除逻辑为保持协议格式对等而保留，由其序列化器测试固定）。setter 测试和 core.md 粘贴行已移除；`GenerateOptions` 与 `ToolSchema` 在 `scripts/type-equiv.manifest.json` 中保留各自的行，因为两个类型只是少了一个字段，本身仍然存在。

本 Agent Note 刻意不触及 `temperature`、`stop` 或 `maxTokens`：两个适配器都会端到端遵守它们，而且它们自然是 `agent/request` 上修改请求的钩子插件首批目标。

## 曾考虑的替代方案

### 为什么不保留？

「显式的 UNSUPPORTED throw 是诚实的契约行为」——但一个在两个孪生适配器中唯一的实现就是拒绝的旋钮，什么也没承诺；删除它反而升级了失败模式：意外的 setter 变成编译错误而非运行时 throw。「Strict schema 遵循是官方文档记载的提供方功能，且管道完整」——但一个旋钮在有已发布的工具设置它并且有端点兑现它之前，不构成产品表面；今天两者都不成立。它们各自随首个真实 producer 回归：`prefill` 随实现了 chat-prefix completion 的适配器（以及对不支持该功能的适配器的明确策略）一起回来；`strict` 随需要它的工具和 beta 端点方案一起回来。

## 验证

`rg prefill` 只返回 Agent Note 记录（本文及[内容块词汇 Agent Note](../architecture/2026-06-11-content-block-vocabulary.md)中由生产者门控的后果）；限定在工具 schema 范围内的 `rg strict` 只返回本 Agent Note、保留下来的 pi-ai 清理逻辑，以及 `strictEqual` 等无关正文。两个适配器的契约测试都能在没有守卫的情况下通过，pi-ai 修正仍会清理库的 strict 默认值——其 serializer 测试固定了线协议一致性。

## 后果

已发布的钩子桥接不设置任何请求字段，而请求变更插件（`agent/request` waterfall（瀑布式事件）监听器）使用的是 `temperature`/`stop`（保留且可用），而非适配器拒绝的字段。如果 chat-prefix completion 或 strict 模式成为产品功能，重新添加将随适配器/端点工作一起落地，届时契约能说明实际发生了什么，而不是「所有人都 throw」。
