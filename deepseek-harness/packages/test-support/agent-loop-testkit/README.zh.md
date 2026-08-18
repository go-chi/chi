# `@deepseek-ai/dsh-agent-loop-testkit`

[English](README.md) | 中文

为运行具体 `AgentLoop` 的测试共享挂载先决依赖。`mountAgentLoopTestDependencies(ctx, options?)` 按依赖顺序安装 LLM（大语言模型）、会话、系统提示词、工具和 agent（智能体）服务，然后在 agent loop 挂载前返回。

调用方注册适配器和可选插件，使用待测配置挂载 `AgentLoop`，并 dispose（资源释放）自己的 Context。系统提示词和工具注册表配置可通过 `options` 转发；该辅助函数不提供超出服务自有默认值的测试默认值。插件加载失败会使辅助函数调用被拒绝，而顺序中较早激活的服务仍归调用方的 Context 所有。

```ts
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'

const ctx = new Context()

await mountAgentLoopTestDependencies(ctx)
// Register the test adapter and any optional plugins here.
await ctx.plugin(AgentLoop, { agents: [] })
```

针对注入失败、部分拓扑、服务加载顺序或服务清理的测试会直接挂载其依赖，而不使用此辅助函数。

## 模型体验

无。该测试专用组合辅助工具既不驱动也不修改模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **只共享必需的先决主干**：适配器、可选插件、`AgentLoop`、agent 和 Context 清理仍由调用方负责，以使特定场景的挂载顺序清晰可见。
