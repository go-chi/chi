# @deepseek-ai/dsh-client-ui-message-feedback

[English](README.md) | 中文

单条消息反馈插件的浏览器侧：一对 Like/Dislike 按钮加一个可选备注，作为 `conversation.chat.assistant-actions` 条带的 `feedback` 条目（order 10）贡献。该条带由 `ui-conversation` 声明，渲染在已定稿助手消息的 IconActions 行内、复制与分支之间，因此控件沿用该行的样式与 hover 行为。只有已定稿的消息能到达这个 slot——被中断冻结的部分输出不带 `messageId`，因此也没有反馈控件。该操作栏每个 Turn 渲染一次，位于持有该 Turn IconActions 行的收尾助手消息上：多步骤 Turn 中较早的步骤产出的是工具行而非可评分正文，因此即使 Host 会接受它们作为目标，界面上也不出现控件。

每个 Session 一个 `MessageFeedbackController`，支撑该 Session 内所有消息的控件，因此一次 `messageFeedback.list` 读取即可填充整段对话。该读取延迟到首次 hover 或 focus 才发起，而不是在挂载时触发，因为可见历史中每条已结束的消息都会挂载一次控件。

变更通过 `ctx.remote.messageFeedback` 提交，按条目的 compare-and-set 由 Host 负责。每次 `put` 和 `delete` 都携带本 controller 最后观察到的 `version`；`version-conflict` 响应会带回权威条目，因此竞争失败时直接用该响应对账，无需重新拉取整个 Session。变更按 Session 串行，排队中的操作总是与已提交的版本比较。再次点击已记录的评分会撤回反馈；切换到另一侧会保留已有备注。

`/client` 导出插件本体（`apply`/`inject`）、`MessageFeedbackActions` 组件、`MessageFeedbackController` 类以及注入面类型。

## 模型体验

无。反馈是 sidecar，不进入 append-only 的 Session 日志、模型上下文或遥测；任何评分与备注对模型都不可见。

#### KV Cache 影响

无；任何反馈变更都不触碰历史尾部。

## 已知限制与暂缓事项

- **备注大小是 Host 策略** —— 部署方配置 `maxNoteBytes`（Web bundle 中为 8192），超长备注由 Host 以 `note-too-large` 拒绝。编辑器不预先校验该上限，因此超长备注在保存时才失败，而不是在输入过程中。
- **无跨标签页推送** —— 另一个标签页的评分要等到重连或下一次冲突响应才可见，不会立即出现；该 sidecar 不发布实时帧。
- **仅限对话视图** —— trajectory 与 waterfall 视图不渲染反馈控件，尽管它们的助手节点现在也带有相同的 `messageId`。
