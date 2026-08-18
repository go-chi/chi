# Agent Note: 移除未被消费的 web 观测接口——`providers-change` 事件与 status 方法

Status: implemented
Archived: 2026-07-26

[English](2026-07-04-drop-unconsumed-web-observation-surface.md) | 中文

## 问题

`WebService` 暴露了一组没有任何生产代码观测的观测接口：

- **`web/providers-change`**（`packages/web/web/src/index.ts`）在每次提供方注册和 dispose（资源释放）时声明并发出，且每个注册 effect 的回滚 yield 被刻意排在 emit 之前，唯一目的是让抛出异常的 change listener 能回退注册。在该包自身的两个单元测试之外没有任何 listener（其中一个测试的存在仅仅是为了固定那个回滚顺序）。
- **`searchStatus()` / `fetchStatus()` 与 `WebCapabilityStatus` 联合类型**（同一包）没有生产调用方：`dsh-tool-web` 直接通过 `ctx.web.search()`/`fetch()` 执行，并把不可用性呈现为 seam 在执行时抛出的结构化 `WebError` code（`packages/web/tool-web/src/search.ts`、`packages/web/tool-web/src/fetch.ts`）；唯一的 status 调用方是 web 包自己的测试。`packages/web/tool-web/README.md` 和 [architecture.md](../../../../docs/architecture.md) 中的正文声称工具“只读取聚合的 `searchStatus()`/`fetchStatus()`”——这种漂移之所以存续，只是因为没有机制对照调用位置检查正文。

seam 自身的设计使这两个接口天然没有消费方：工具注册跟随产品 ENABLEMENT 而非提供方可用性（`packages/web/tool-web/src/index.ts`），提供方选择在执行时解析且从不缓存——因此没有需要失效的缓存、没有需要重算的注册集合、也没有调用方需要一个有别于「执行并路由结构化错误」的可用性探测。HMR（热模块替换）清理由 effect disposer 自身承载。

这与[删除无人消费的 `llm/adapter-change` 事件](2026-06-20-drop-unconsumed-llm-adapter-change-event.md)相呼应；后者从 `LlmService` 移除了相同的通知形状、相同的 emit 前回滚机制和相同的监听器抛错测试。该 Agent Note（agent 决策记录）的保留/删除标准是：为可能面向用户的工具列表消费方保留 `tools/change`，删除启动时后端注册表信号。按这一标准，web 提供方注册表明确属于删除一侧；status 方法则是把同一判断应用于拉取表面，而非推送表面。

## 决策

移除注册表变更事件、聚合 status 方法与类型，以及它们的专属测试。提供方私有的 status 保留用于执行时选择。面向调用方的覆盖率现在断言成功执行或结构化的选择错误，web 文档描述该按需调用契约。

## 曾考虑的替代方案

### 为什么不保留？

web seam Agent Note 刻意规定了两者——事件作为最小 HMR 可见性信号，status 方法作为工具的聚合诊断——未来也可以设想提供方状态面板。但同一 Agent Note 的其他选择让它们失去了生存条件：调用时派生选择和基于启用状态的注册，使任何消费方都不可能需要其中任一项；已发布工具展示了真实模式（执行并路由结构化错误）；发生漂移的 README 句子则表明承诺中的消费方从未出现。按照 AGENTS.md 所述“Agent Note 是提案，而非绝对真理”，代码后来证明提案中的这些部分超出了需要；未来的观察者应根据真实消费方的形状，重新引入它实际消费的最小信号或查询。

## 验证

除 Agent Note 历史外，不再存在 `providers-change`、`searchStatus`、`fetchStatus` 或 `WebCapabilityStatus` 拼写；目录保持新鲜（`verify-cordis-catalog` 为绿色）；注册/释放 HMR 安全性测试通过执行行为证明清理；tool-web README 和架构段落也描述了工具实际拥有的执行时错误路由契约。

## 后果

未来若有提供方选择器 UI 或诊断面板需要变更通知或 status 查询，它将重新添加自身所消费的最小接口；相同的判断及其反转条件已记录在 LLM（大语言模型）先例中。
