# @deepseek-ai/dsh-session-title-all-prompts-llm

[English](README.md) | 中文

可选的 `ctx.sessionTitle` 提供方，通过 `ctx.llm` 总结所有符合条件的用户消息。它注册 `all-prompts` 节奏，并在每条新用户提示词后启动新 revision，同时使用预置历史与子会话提示词。较新的 revision 会中止并取代旧工作；即使提供方忽略取消，也无法提交陈旧输出。

该插件使用完整且必填的[共享 LLM（大语言模型）配置](../session-title-llm/README.md#configuration)。同时省略 `provider` 与 `model` 时，会继承每个当前已记录主请求的确切路由；也可以同时设置二者，使标题生成使用独立路由。如果最终封装的聚合提示词超过 `maxInputBytes`，请求会失败而不是截断历史；自动使用时会发出警告并保留先前标题。

## 模型体验

### 全消息标题请求

#### 模型看到的内容

标题模型会收到共享标题指令，以及一个 JSON 数组，其中按日志顺序包含截至当前 revision 的所有符合条件用户消息和确切 seq。预置历史也包含在内。

#### Token 影响

每条符合条件的新提示词之后都可能发送一次辅助请求，每次请求受 `maxInputBytes` 和 `maxOutputTokens` 约束；显式刷新可能增加调用。主 agent（智能体）请求不会增加 token。

#### KV Cache 影响

不会使主请求的 KV Cache 失效。每条提示词后，辅助输入都会增长或变化，因此提供方专用缓存复用会在第一个变化的 JSON token 处结束。

## 已知限制与暂缓事项

- 输入溢出时保留先前标题；对于很长的会话，此提供方没有基于摘要继续生成摘要的机制或保留策略。
- 它平等对待所有符合条件的用户消息，不提供权重、过滤或手动标题优先级。
