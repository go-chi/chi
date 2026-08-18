# Agent Note: 移除无消费方的 skill 提供方事件

Status: implemented
Archived: 2026-07-26

[English](2026-07-12-drop-unconsumed-skill-provider-events.md) | 中文

## 问题

skill（技能）注册表产出两个通知事件，但没有生产环境的监听方。生成的生产者/消费方矩阵以及对事件名的精确搜索表明，`skill/provider-added` 与 `skill/provider-removed` 仅出现在声明、emit 站点、测试、生成的 catalog 和行文中。

skill 发现按需读取当前的提供方映射表，提供方注册时同步清除已完成的 catalog，而 await 后的版本检查阻止了陈旧的发现结果进入缓存。没有兄弟插件通过这些事件等待 skill 提供方——与之形成对比的是活跃的 `subagent/provider-added` 消费方，它容忍兄弟并发加载。

`tools/change` 与 `system-prompt/change` 明确不在本提案范围内。既有的简化决策将它们保留为面向实时工具和提示词 UI 的有意观测点，且自引用的已挂载插件已在使用 `tools/change`。本提案同样不改动 `subagent/provider-added`/`removed`，因为 `tool-subagent` 有生产环境的生命周期消费方。

## 决策

skill 注册表不再声明和 emit 提供方成员变更事件。提供方的注册与 dispose（资源释放）仍为 effect 所有的直接状态变更，同步使已完成的 catalog 失效；查找与发现按需读取当前提供方映射表。测试通过提供方查找和收集到的输出来观察清理行为，而非依赖生命周期通知。

生成式事件目录、API 目录和生产者/消费方矩阵均不再包含已删除通知。skill system Agent Note（agent 决策记录）和包文档改为通过其由 effect 直接拥有的状态与 cache 失效契约描述注册。

## 曾考虑的替代方案

**为未来插件保留 skill 提供方通知。** 第三方插件可能想观察提供方的可用性，但直接提供方注册与按需查找才是扩展契约；当前没有消费方需要推送信号。如果将来出现兄弟加载竞态，可以像 subagent 注册表那样，引入一个带有该消费方实际所需的身份与就绪语义的通知。

## 后果

生成的事件矩阵中不再有 `skill/provider-added` 或 `skill/provider-removed` 的行。skill 发现、直接运行时注册、提供方 effect 回滚/dispose、缓存失效与注册表查找清理保持不变；监听方触发的回滚随事件一起消失。`tools/change`、`system-prompt/change` 以及已被消费的 subagent 提供方生命周期事件不受影响。

预发布消费方失去 skill 提供方观测点，但仍保留两种贡献 skill 的方式：直接运行时注册与提供方注册。未来若有消费方需要实时的提供方可用性信息，必须新增一个带有其实际所需的身份与就绪语义的专用通知。
