# Agent Note: 裁剪 web seam 中未使用的字段

Status: implemented
Archived: 2026-07-26

[English](2026-07-12-prune-unused-web-seam-fields.md) | 中文

## 问题

web 能力携带的 request/result/status 值，虽然每个已交付的实现都会填充，但没有任何生产环境的消费方读取它们。`WebSearchResult.providerId`、`query` 与 `WebFetchResult.providerId` 是结果回显；`tool-web` 只格式化 content/sources/truncation 或最终 URL/status/body/truncation，没有其他运行时读取这些字段。搜索提供方返回 `WebProviderStatus.reason`，但可用性检查只看 `available`，并有意输出一条通用的不可用诊断信息。

`WebFetchRequest.timeoutMs` 同样从未被生产调用方设置。`tool-web` 只提供 URL，使用工具定义的 timeout 加 `exec.signal` 作为调用方截止时间，并依赖本地提供方的配置默认值作为兜底。这个未使用的逐请求覆盖迫使 `web-fetch-local` 暴露 `maxTimeoutMs`、对两个 timeout 来源做 clamp，并为没有任何产品路径能选中的优先级规则编写文档和测试。`WebExecContext` 则是另一个单字段包装层：每个调用方分配 `{ signal }`，每个提供方立即解包 `exec?.signal`；不存在第二个执行控制字段。

## 决策

web seam 移除搜索/抓取结果中的 `providerId` 回显和搜索的 `query` 回显；调用方本身已持有请求和提供方选择信息。提供方以返回布尔值的方法暴露可用性。抓取请求不再有逐请求 timeout 或 `maxTimeoutMs` clamp；本地提供方保留其可配置的默认 timeout，工具保留自身的截止时间。提供方方法直接接收一个可选的 `AbortSignal`，而非单字段的 `WebExecContext` 包装层。

所有 web 实现与面向模型的工具使用更精简的契约。接口/实现/消费方的包（package）拆分、提供方选择、来源引用、最终 URL/状态数据、截断报告与安全限制保持不变。

## 曾考虑的替代方案

**保留自描述结果、逐请求截止时间与可扩展的执行上下文对象。** 结果回显可以帮助通用遥测，请求级 timeout 可以帮助受信的程序化调用方，包装层则为未来的控制字段留出空间。但目前不存在这样的消费方或第二个字段；在每个提供方中携带重复的身份标识、第二套截止时间策略以及包装/解包管道，使当前契约更难实现和解释。如果遥测或逐调用预算控制到来，届时应当定义哪个截止时间优先、在哪里观测提供方身份，以及多个控制字段是否足以证明需要一个上下文对象。

## 后果

保留下来的每个 web request/result 字段，要么被生产代码消费，要么是执行提供方请求所必需的。工具可见的搜索/抓取输出、提供方回退、中止行为、可配置的 timeout 兜底、截断与引用仍然被覆盖，无需请求级 timeout 优先级分支或执行上下文包装层。

预发布阶段的程序化调用方失去了结果来源回显和逐请求的抓取截止时间。提供方仍具备部署级可配置 timeout 并尊重取消信号，因此这次精简移除的是可配置性，而非安全边界。
