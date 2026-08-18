# @deepseek-ai/dsh-session-title-first-prompt-llm

[English](README.md) | 中文

可选的 `ctx.sessionTitle` 提供方，通过 `ctx.llm` 总结第一条符合条件的用户消息。它注册 `first-prompt` 节奏，只在全新非 fork 会话首次创建回退时自动运行，并将结果归因于该消息的确切 seq。自动失败会保留回退，之后只能通过 `ctx.sessionTitle.refresh()` 重试。

该插件使用完整且必填的[共享 LLM（大语言模型）配置](../session-title-llm/README.md#configuration)。同时省略 `provider` 与 `model` 时，会继承当前已记录主请求的确切路由；也可以同时设置二者，使标题生成使用独立路由。

## 模型体验

### 首消息标题请求

#### 模型看到的内容

标题模型会收到共享标题指令，以及一个只包含第一条符合条件用户消息的 JSON 数组。后续提示词与继承的 fork 历史不会触发再次自动调用。

#### Token 影响

全新会话最多自动发出一次辅助请求，并受 `maxInputBytes` 和 `maxOutputTokens` 约束；显式刷新可能发出额外调用。主 agent（智能体）请求不会增加 token。

#### KV Cache 影响

不会使主请求的 KV Cache 失效。辅助请求使用已配置或已记录路由，其缓存行为由提供方决定。

## 已知限制与暂缓事项

- 对于长期会话，第一条消息可能不再具有代表性；如果后续提示词应触发重新生成标题，请使用全消息提供方。
- fork 会保留继承的标题，绝不会自动运行此提供方，即使其预置的首消息来自父会话。
