# @deepseek-ai/dsh-agent-default-model

[English](README.md) | 中文

该部署默认值供入口在创建尚无会话级模型选择的 Agent 时使用。`AgentDefaultModelConfig` 提供 `ctx.agentDefaultModel`；`dsh --profile headless` 这类直接入口与 ApiProxy 这类由 Host 支撑的入口读取同一服务，而不是分别持有平行的提供方／模型默认值。

插件配置必须提供 `{ provider, model }`。该组合配置项构成 Settings 中 `agent-default-model` 分节的基础层；挂载的设置提供方在其上叠加用户选择，更改会在下一次调用 `currentSelection()` 时可见。`reasoningEffort` 属于该 Settings 分节，但特意不属于插件配置：完整保存的选择必须能在下一个选定模型没有推理（reasoning）强度时清除旧值，而组合配置值会再次被继承。

- `ctx.agentDefaultModel.currentSelection()` 返回一份独立的 `{ provider, model, reasoningEffort? }` 选择，供新创建的 Agent 使用。
- `ctx.agentDefaultModel.saveSelection(selection)` 保存完整的用户选择。未挂载设置提供方时，此调用不执行任何操作，组合配置项仍为当前值。

该服务不校验目录成员关系。提供方路由可以服务未在目录中公布的模型；实际发起模型请求的消费方负责可用性诊断。

## 模型体验

通过提供给入口的提供方／模型选择间接影响；模型可见请求由请求组装与适配器负责。

#### KV Cache 影响

更改默认值只影响之后从该默认值解析选择的 Agent。请求日志已经指明选择的现有会话仍沿用该选择，因此本服务不会使其已建立的前缀失效。

## 已知限制与暂缓事项

- 该服务只拥有一项进程级默认值；每个会话的选择仍由入口负责。
- 未挂载设置提供方时，`saveSelection()` 无法保留选择供后续 Agent 使用。
